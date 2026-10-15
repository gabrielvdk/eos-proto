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

   Roles: admin = in ADMIN_EMAILS (always) or person.admin · member = assigned to at least one unit (person.unitIds)
   · pending = signed in, not assigned yet: sees and changes nothing. The organisation manages itself: members change goals,
   rocks, cards and memberships of their units and everything below them, and the structure below their units; they see
   only those Level 10 boards (createRights below; the page uses the same block).

   store interface (Cosmos DB in index.js, memory in createMemoryStore):
     list() → all item docs incl. _etag · listType(type) → the docs of one type · get(type, id) → doc|null · put(doc, ifMatch) → saved doc,
     throws {code:412} on a stale ifMatch · remove(type, id) · getAttachment(id) → doc|null · putAttachment(doc) → no-op if it exists */
(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory();
  else root.EosApiCore=factory();
})(typeof self!=="undefined"?self:this,function(){
  "use strict";
  const COLLECTIONS=["meta","people","units","goals","rocks","cards"]; // "meta" holds one record {id:"meta", version}
  const ORG=["people","units"]; // the org tree and who belongs where
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
/* rights:start — this block is identical in index.html and api/src/core.js (tests/api-core.test.html checks that).
   Who may see and change what. The tree: company → departments → teams; meetings (forums) and teams without a department
   hang under the company. Rights flow down, never up: belonging to a unit gives rights on it and on everything below it
   (a director in the company has rights everywhere; a team member has none on the department above). Admins: everything,
   even without any unit, and only admins grant the admin flag. Everyone assigned sees the whole organisation
   and all goals; rocks and Level 10 boards only where they have rights.
   - goals, rocks, cards: change them in units you have rights on. Goals live on any unit; rocks and Level 10 boards only
     on teams and meetings ("team level"). A meeting's members also fully edit the rocks the meeting shows.
   - membership ("who is in a unit"): add and remove people in units you have rights on (a team member: their own team).
   - structure (create, rename, reorder, delete, move a unit): only units *below* your own: a department member manages
     its teams, a company member the departments, teams and meetings. A unit can't change itself or anything above it.
   - private meetings (unit.private, e.g. the DT Team): only their direct members see and change their rocks and board,
     and the goals set to be visible to them only (goal.visibleTo).
     Rights don't flow into them, not even for admins; their rocks never show up in other meetings; only members rename,
     delete or un-private them. Admins can still add themselves as a member (break-glass, visible to everyone). */
function createRights({units,people,adminEmails}){
  const byId=new Map(units.map(u=>[u.id,u]));
  const company=units.find(u=>u.kind==="company");
  // the unit above u (also for a record not stored yet): a team's department, else the company
  const parentOf=u=>u.kind==="company"?null:u.kind==="team"&&byId.get(u.parentId)?.kind==="department"?byId.get(u.parentId):company||null;
  const above=new Map(); // unit id → the ids of the units above it
  for(const u of units){const ids=[];for(let p=parentOf(u),n=0;p&&n<10;p=parentOf(p),n++)ids.push(p.id);above.set(u.id,ids)}
  const admins=(adminEmails||[]).map(e=>String(e).toLowerCase());
  const isAdmin=p=>!!p&&(p.admin===true||admins.includes(String(p.email||"").toLowerCase()));
  const memberOf=p=>(p&&p.unitIds)||[];
  const isMember=(p,unitId)=>memberOf(p).includes(unitId); // directly, not through a unit above
  const isPrivate=unitId=>byId.get(unitId)?.private===true;
  const role=p=>isAdmin(p)?"admin":memberOf(p).length?"member":"pending";
  const hasRights=(p,unitId)=>isPrivate(unitId)?isMember(p,unitId)
    :isAdmin(p)||memberOf(p).some(m=>m===unitId||(above.get(unitId)||[]).includes(m));
  const canSeeContent=(p,unitId)=>!isPrivate(unitId)||isMember(p,unitId); // a private meeting's rocks and cards: members only
  // the rocks a meeting shows: its own, and (if its rules say so) tracked or escalated ones, never a private meeting's
  const inForum=(f,r)=>r.unitId===f.id||(!isPrivate(r.unitId)&&((f.includeTracked&&(r.trackIn||[]).includes(f.id))||(f.includeEscalated&&r.status==="escalate")));
  // rocks: your units' rocks, plus every rock a meeting you're in shows (its members fully edit those)
  const canEditRock=(p,r)=>hasRights(p,r.unitId)||units.some(f=>f.kind==="forum"&&inForum(f,r)&&hasRights(p,f.id));
  const teamLevel=id=>{const u=byId.get(id);return !!u&&(u.kind==="team"||u.kind==="forum")}; // where rocks and boards live
  // goals visible to a private meeting only (goal.visibleTo, e.g. the DT Team's company goals): its members only, admins too
  const canSeeGoal=(p,g)=>!g.visibleTo||isMember(p,g.visibleTo);
  const canEdit={goals:(p,g)=>canSeeGoal(p,g)&&hasRights(p,g.unitId),rocks:canEditRock,cards:(p,c)=>hasRights(p,c.unitId)};
  // structure: managed by whoever has rights on the unit above (so never by the unit itself); the company only by admins;
  // a private meeting only by its own members
  const canManageUnit=(p,u)=>u.private===true||isPrivate(u.id)?isMember(p,u.id)
    :isAdmin(p)||(u.kind!=="company"&&!!parentOf(u)&&hasRights(p,parentOf(u).id));
  const canManageMembers=(p,unitId)=>hasRights(p,unitId)||isAdmin(p); // admins may always add themselves (break-glass)
  // a record's fields apart from some keys (and _etag etc.), to check that nothing else changed
  const fieldsBut=(x,skip)=>JSON.stringify(Object.keys(x||{}).filter(k=>!skip.includes(k)&&k[0]!=="_").sort().map(k=>[k,x[k]]));
  return {
    isAdmin,role,hasRights,canEditRock,teamLevel,canManageUnit,canManageMembers,isMember,isPrivate,canSeeContent,inForum,canSeeGoal,
    canSeeRock:canEditRock, // rocks: you see exactly the ones you can change (your teams and below, plus what your meetings show)
    canEditGoal:canEdit.goals,
    canEditCard:canEdit.cards,
    canSeeBoard:(p,unitId)=>teamLevel(unitId)&&hasRights(p,unitId), // Level 10: the team and meeting boards of your units and below
    // the team filter: the company, your units, the units above them and the units below them (private meetings: members only)
    branch(p){
      const ids=new Set(company?[company.id]:[]);
      if(isAdmin(p))units.forEach(u=>ids.add(u.id));
      const mine=memberOf(p);
      for(const m of mine){ids.add(m);(above.get(m)||[]).forEach(id=>ids.add(id))}
      for(const u of units)if((above.get(u.id)||[]).some(id=>mine.includes(id)))ids.add(u.id);
      return units.map(u=>u.id).filter(id=>ids.has(id)&&canSeeContent(p,id));
    },
    // may p replace `before` with `after` in a collection (before = null: create, after = null: delete)? Checked on every write.
    writeAllowed(p,collection,before,after){
      if(role(p)==="pending")return false;
      if((collection==="rocks"||collection==="cards")&&after&&!teamLevel(after.unitId))return false; // for everyone, admins too
      if((collection==="rocks"||collection==="cards")&&[before,after].some(x=>x&&!canSeeContent(p,x.unitId)))return false; // private: admins too
      if(collection==="units"&&before&&before.private===true&&!isMember(p,before.id))return false; // only members change a private meeting, admins too
      if(collection==="goals"&&[before,after].some(g=>g&&!canSeeGoal(p,g)))return false; // a hidden goal: its meeting's members only, admins too
      if(collection==="goals"&&after&&after.visibleTo&&!isPrivate(after.visibleTo))return false; // hidden only behind a private meeting
      if(isAdmin(p)||collection==="meta")return true;
      if(collection==="units"){ // structure: rights on the unit above, before and after (moving a team needs both departments)
        if(!before&&!after)return false;
        if(after&&(after.kind==="company"||(before&&before.kind!==after.kind)))return false;
        if(!before&&after.private===true)return !!parentOf(after)&&hasRights(p,parentOf(after).id); // creating a private meeting
        return (!before||canManageUnit(p,before))&&(!after||canManageUnit(p,after));
      }
      if(collection==="people"){ // membership only: nothing else of a person changes, and every unit added or removed is yours
        if(!before||!after||fieldsBut(before,["unitIds"])!==fieldsBut(after,["unitIds"]))return false; // people are created at sign-in
        const was=memberOf(before),now=memberOf(after);
        return [...now.filter(id=>!was.includes(id)),...was.filter(id=>!now.includes(id))].every(id=>canManageMembers(p,id));
      }
      const can=canEdit[collection];if(!can)return false;
      if(before&&!can(p,before))return false;
      // creating, or moving to another unit, needs rights on that unit itself: a meeting member may edit and resolve
      // the rocks it shows, but not move them to another team or create rocks for other teams
      if(after&&(!before||after.unitId!==before.unitId)&&!hasRights(p,after.unitId))return false;
      return true;
    },
  };
}
/* rights:end */

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
    // the signed-in person (a bare {email} until their record exists) and the rights over the current org tree
    async function whoAndRights(email){
      const [units,people]=await Promise.all([store.listType("units"),store.listType("people")]);
      const me=people.find(p=>sameEmail(p,email))||{email,unitIds:[]};
      return {me,rights:createRights({units,people,adminEmails})};
    }
    const roleOf=(person,email)=>createRights({units:[],people:[],adminEmails}).role({...(person||{}),email:(person&&person.email)||email});
    const deny=a=>reply(a.status,{error:a.reason});
    function target(params){
      const {collection,id}=params||{};
      if(!COLLECTIONS.includes(collection)||!ID_RE.test(id||"")||(collection==="meta")!==(id==="meta"))return null;
      return {collection,id};
    }
    // checks everything a write needs (after = the new record, null for a delete); returns a reply to send back, or null to go ahead
    async function refuseWrite(principal,params,after){
      const a=access(principal);if(!a.ok)return deny(a);
      const t=target(params);if(!t)return reply(400,{error:"Unknown collection or id."});
      const {me,rights}=await whoAndRights(a.email);
      const before=await store.get(t.collection,t.id);
      if(rights.writeAllowed(me,t.collection,before&&toRecord(before),after))return null;
      const why=rights.role(me)==="pending"?"You haven't been added to a team yet."
        :ORG.includes(t.collection)?"You can only change the organisation where you have rights (your own units and below)."
        :"You can only change items of your own teams.";
      return reply(403,{error:why});
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
        const rights=createRights({units:out.units,people:out.people,adminEmails}),role=rights.role(me);
        if(role==="pending")return reply(200,{waiting:true,role,meId:me.id,me:{name:me.name,email:a.email}}); // nothing else until assigned
        out.cards=out.cards.filter(c=>rights.canSeeBoard(me,c.unitId)); // Level 10 boards only where you have rights
        out.rocks=out.rocks.filter(r=>rights.canSeeRock(me,r)); // only the rocks you may change: your teams and below, your meetings
        out.goals=out.goals.filter(g=>rights.canSeeGoal(me,g)); // goals hidden behind a private meeting only to its members
        return reply(200,{...out,meId:me.id,role,adminEmails});
      },
      async putItem({principal,params,body}){
        const a=access(principal);if(!a.ok)return deny(a);
        const t=target(params),record=body&&body.record;if(!t)return reply(400,{error:"Unknown collection or id."});
        if(!record||typeof record!=="object"||Array.isArray(record)||record.id!==t.id)return reply(400,{error:"Send {record, ifMatch} with record.id matching the URL."});
        const refused=await refuseWrite(principal,params,record);if(refused)return refused;
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
        const refused=await refuseWrite(principal,params,null);if(refused)return refused;
        const t=target(params);if(t.collection==="meta")return reply(400,{error:"Unknown collection or id."});
        await store.remove(t.collection,t.id);
        return {status:204};
      },
      async attachment({principal,params}){
        const a=access(principal);if(!a.ok)return deny(a);
        const {me,rights}=await whoAndRights(a.email);
        if(rights.role(me)==="pending")return reply(403,{error:"You haven't been added to a team yet."});
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
      async get(type,id){const d=db.items[key(type,id)];return d?copy(d):null},
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

  return {createApi,createMemoryStore,createRights,parsePrincipal,displayName,COLLECTIONS,ORG};
});
