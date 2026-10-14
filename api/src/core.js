/* EOS Tracker API: the server logic, free of any Azure dependency.
   Used by src/index.js (Azure Functions + Cosmos DB) and, for development, by index.html with ?backend=mock
   (runs in the browser against a localStorage "database"); tests: tests/api-core.test.html.
   Keep it plain JavaScript that runs in both Node and the browser.

   Routes (all under /api; all but config need a signed-in user who passes the allow-list):
     GET    config                      → {app, backend, env, seed, user, access}
     GET    data                        → members/admins: {meta, people, units, goals, rocks, cards, meId, role, adminEmails}
                                          (records carry _etag); waiting people: {waiting:true, meId, me, role:"pending"}
     PUT    items/{collection}/{id}     body {record, ifMatch}  → {record}   412 when ifMatch is outdated
     DELETE items/{collection}/{id}     → 204
     GET    attachments/{sha256}        → the image (pasted images are moved out of descriptions on save)

   Roles (roleOf): admin = in ADMIN_EMAILS (always) or person.admin · member = assigned to at least one unit (person.unitIds)
   · pending = signed in, not assigned yet: sees and changes nothing. Only admins change people and units (the org tree).

   store interface (Cosmos DB in index.js, memory in createMemoryStore):
     list() → all item docs incl. _etag · listType(type) → the docs of one type · put(doc, ifMatch) → saved doc,
     throws {code:412} on a stale ifMatch · remove(type, id) · getAttachment(id) → doc|null · putAttachment(doc) → no-op if it exists */
(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory();
  else root.EosApiCore=factory();
})(typeof self!=="undefined"?self:this,function(){
  "use strict";
  const COLLECTIONS=["meta","people","units","goals","rocks","cards"]; // "meta" holds one record {id:"meta", version}
  const ADMIN_ONLY=["people","units"]; // the org tree and who belongs where
  const ID_RE=/^[A-Za-z0-9_-]{1,80}$/;
  const HASH_RE=/^[a-f0-9]{64}$/;
  const MAX_ITEM_CHARS=1900000; // Cosmos DB items are limited to 2 MB
  const DATA_IMG=/src="data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)"/g;
  const COLORS=["#5B4BDB","#1F8FD1","#19A974","#E29A1C","#D93B4F","#0E7A5A","#7C4DFF","#00897B","#C2185B","#5D4037"];
  const SYSTEM_FIELDS=["_rid","_self","_attachments","_ts"];

  const list=s=>String(s||"").split(/[,;\s]+/).map(x=>x.trim().toLowerCase()).filter(Boolean);
  const hashCode=s=>[...s].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
  const reply=(status,json)=>({status,json});
  const sameEmail=(p,email)=>String((p&&p.email)||"").toLowerCase()===email;

  // the x-ms-client-principal header (base64 JSON) that Static Web Apps adds for signed-in users
  function parsePrincipal(header,decodeBase64){
    if(!header)return null;
    try{const p=JSON.parse(decodeBase64(header));return p&&p.userId?p:null}catch(e){return null}
  }
  function displayName(p){
    const claim=(p.claims||[]).find(c=>c.typ==="name"||/\/claims\/name$/.test(c.typ||""));
    if(claim&&claim.val&&!String(claim.val).includes("@"))return String(claim.val).slice(0,100);
    const local=String(p.userDetails||"user").split("@")[0];
    return local.split(/[._-]+/).filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(" ")||"User";
  }
  // database doc → API record: drop Cosmos system fields and the partition key, keep _etag
  function toRecord(doc){
    const r={...doc};
    SYSTEM_FIELDS.forEach(k=>delete r[k]);delete r.type;
    return r;
  }

  /* settings: APP_ENV (test|prod|…), SEED (sample|org), ALLOWED_EMAIL_DOMAINS, ALLOWED_EMAILS ("*" = anyone who can sign in),
     ADMIN_EMAILS (always admin, always allowed in), KEEP_INLINE_IMAGES ("true": leave pasted images inside descriptions; browser mock) */
  function createApi({store,settings,sha256,newId}){
    const adminEmails=list(settings.ADMIN_EMAILS);
    function access(principal){
      if(!principal)return {ok:false,status:401,email:"",reason:"Not signed in."};
      const email=String(principal.userDetails||"").toLowerCase();
      const domains=list(settings.ALLOWED_EMAIL_DOMAINS),emails=list(settings.ALLOWED_EMAILS);
      if(adminEmails.includes(email))return {ok:true,status:200,email};
      if(!domains.length&&!emails.length)
        return {ok:false,status:403,email,reason:"Access isn't configured yet: set ALLOWED_EMAIL_DOMAINS or ALLOWED_EMAILS in the app settings."};
      const ok=domains.includes("*")||emails.includes(email)||domains.some(d=>email.endsWith("@"+d.replace(/^\*?@/,""))); // "letsgrow.com", "@letsgrow.com" and "*@letsgrow.com" all work
      return ok?{ok:true,status:200,email}:{ok:false,status:403,email,reason:`${email||"This account"} has no access to EOS Tracker.`};
    }
    function roleOf(person,email){
      if(adminEmails.includes(email)||(person&&person.admin===true))return "admin";
      return person&&Array.isArray(person.unitIds)&&person.unitIds.length?"member":"pending";
    }
    // the caller's role, for writes: looks up their person record
    async function callerRole(email){
      const people=await store.listType("people");
      return roleOf(people.find(p=>sameEmail(p,email)),email);
    }
    const deny=a=>reply(a.status,{error:a.reason});
    function target(params){
      const {collection,id}=params||{};
      if(!COLLECTIONS.includes(collection)||!ID_RE.test(id||"")||(collection==="meta")!==(id==="meta"))return null;
      return {collection,id};
    }
    // checks everything a write needs; returns a reply to send back, or null when the write may go ahead
    async function refuseWrite(principal,params){
      const a=access(principal);if(!a.ok)return deny(a);
      const t=target(params);if(!t)return reply(400,{error:"Unknown collection or id."});
      const role=await callerRole(a.email);
      if(role==="pending")return reply(403,{error:"You haven't been added to a team yet."});
      if(ADMIN_ONLY.includes(t.collection)&&role!=="admin")return reply(403,{error:"Only administrators can change the organisation and people."});
      return null;
    }
    // pasted images (data URLs) are stored once as attachments (id = sha256) and referenced by URL
    async function extractImages(html){
      for(const [whole,type,data] of [...html.matchAll(DATA_IMG)]){
        if(data.length>MAX_ITEM_CHARS)return {error:"An image is too large to save."};
        const id=await sha256(data);
        await store.putAttachment({id,contentType:type==="image/jpg"?"image/jpeg":type,data});
        html=html.split(whole).join(`src="/api/attachments/${id}"`);
      }
      return {html};
    }

    return {
      access,roleOf,
      async config({principal}){
        const a=access(principal);
        return reply(200,{
          app:"eos-tracker",backend:"api",env:settings.APP_ENV||"test",seed:settings.SEED==="sample"?"sample":"org",
          user:principal?{email:a.email,name:displayName(principal)}:null,
          access:{ok:a.ok,reason:a.ok?null:a.reason},
        });
      },
      async data({principal}){
        const a=access(principal);if(!a.ok)return deny(a);
        const out={meta:null};COLLECTIONS.slice(1).forEach(c=>out[c]=[]);
        for(const doc of await store.list()){
          if(doc.type==="meta")out.meta=toRecord(doc);
          else if(out[doc.type])out[doc.type].push(toRecord(doc));
        }
        // people come from sign-in: your first visit adds you, without a team (an admin assigns you)
        let me=out.people.find(p=>sameEmail(p,a.email));
        if(!me){
          const person={id:newId(),name:displayName(principal),email:a.email,color:COLORS[hashCode(a.email)%COLORS.length],unitIds:[]};
          me=toRecord(await store.put({...person,type:"people"},null));
          out.people.push(me);
        }
        const role=roleOf(me,a.email);
        if(role==="pending")return reply(200,{waiting:true,role,meId:me.id,me:{name:me.name,email:a.email}}); // nothing else until assigned
        return reply(200,{...out,meId:me.id,role,adminEmails});
      },
      async putItem({principal,params,body}){
        const refused=await refuseWrite(principal,params);if(refused)return refused;
        const t=target(params),record=body&&body.record;
        if(!record||typeof record!=="object"||Array.isArray(record)||record.id!==t.id)return reply(400,{error:"Send {record, ifMatch} with record.id matching the URL."});
        const doc={...record,type:t.collection};
        delete doc._etag;SYSTEM_FIELDS.forEach(k=>delete doc[k]);
        if(typeof doc.description==="string"&&settings.KEEP_INLINE_IMAGES!=="true"){
          const r=await extractImages(doc.description);if(r.error)return reply(413,{error:r.error});
          doc.description=r.html;
        }
        if(JSON.stringify(doc).length>MAX_ITEM_CHARS)return reply(413,{error:"This item is too large to save (max 2 MB)."});
        try{return reply(200,{record:toRecord(await store.put(doc,(body&&body.ifMatch)||null))})}
        catch(e){if(e&&e.code===412)return reply(412,{error:"Changed by someone else in the meantime."});throw e}
      },
      async deleteItem({principal,params}){
        const refused=await refuseWrite(principal,params);if(refused)return refused;
        const t=target(params);if(t.collection==="meta")return reply(400,{error:"Unknown collection or id."});
        await store.remove(t.collection,t.id);
        return {status:204};
      },
      async attachment({principal,params}){
        const a=access(principal);if(!a.ok)return deny(a);
        if(await callerRole(a.email)==="pending")return reply(403,{error:"You haven't been added to a team yet."});
        const id=params&&params.id;if(!HASH_RE.test(id||""))return reply(400,{error:"Unknown attachment."});
        const doc=await store.getAttachment(id);if(!doc)return reply(404,{error:"Attachment not found."});
        return {status:200,base64:doc.data,contentType:doc.contentType,headers:{"cache-control":"private, max-age=31536000, immutable"}};
      },
    };
  }

  // in-memory store for the browser mock and the tests; load/save optionally persist it (e.g. to localStorage)
  function createMemoryStore({load,save}={}){
    const db=(load&&load())||{items:{},attachments:{}};
    let n=0;
    const key=(type,id)=>`${type}/${id}`,copy=x=>JSON.parse(JSON.stringify(x)),persist=()=>save&&save(db);
    return {
      db,
      async list(){return Object.values(db.items).map(copy)},
      async listType(type){return Object.values(db.items).filter(d=>d.type===type).map(copy)},
      async put(doc,ifMatch){
        const cur=db.items[key(doc.type,doc.id)];
        if(ifMatch&&cur&&cur._etag!==ifMatch)throw Object.assign(new Error("Precondition failed"),{code:412});
        const saved={...copy(doc),_etag:`"${Date.now().toString(36)}-${(n++).toString(36)}"`};
        db.items[key(doc.type,doc.id)]=saved;persist();
        return copy(saved);
      },
      async remove(type,id){delete db.items[key(type,id)];persist()},
      async getAttachment(id){return db.attachments[id]?copy(db.attachments[id]):null},
      async putAttachment(doc){if(!db.attachments[doc.id]){db.attachments[doc.id]=copy(doc);persist()}},
    };
  }

  return {createApi,createMemoryStore,parsePrincipal,displayName,COLLECTIONS,ADMIN_ONLY};
});
