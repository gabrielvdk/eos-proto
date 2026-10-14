/* EOS Tracker API on Azure: Azure Functions (Node, v4 programming model) as the managed API of Static Web Apps,
   with Cosmos DB as the store. All logic lives in core.js; this file only connects it to Azure.
   App settings (see docs/AZURE.md): COSMOS_CONNECTION_STRING, COSMOS_DATABASE, APP_ENV, SEED, ADMIN_EMAILS,
   ALLOWED_EMAIL_DOMAINS, ALLOWED_EMAILS (and AZURE_CLIENT_ID / AZURE_CLIENT_SECRET for tenant-locked sign-in). */
const {app}=require("@azure/functions");
const {CosmosClient}=require("@azure/cosmos");
const crypto=require("node:crypto");
const {createApi,parsePrincipal}=require("./core");

/* Cosmos DB: database and containers are created on first use, so a new environment needs no manual setup.
   items: every record, partitioned by /type (people, units, goals, rocks, cards, meta) · attachments: pasted images */
let containersPromise=null;
function containers(){
  containersPromise??=(async()=>{
    const client=new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
    const {database}=await client.databases.createIfNotExists({id:process.env.COSMOS_DATABASE||"eostracker"});
    const {container:items}=await database.containers.createIfNotExists({id:"items",partitionKey:{paths:["/type"]}});
    const {container:attachments}=await database.containers.createIfNotExists({id:"attachments",partitionKey:{paths:["/id"]}});
    return {items,attachments};
  })().catch(e=>{containersPromise=null;throw e}); // retry on the next request
  return containersPromise;
}
const cosmosStore={
  async list(){
    const {items}=await containers();
    const {resources}=await items.items.query("SELECT * FROM c").fetchAll();
    return resources;
  },
  async listType(type){
    const {items}=await containers();
    const {resources}=await items.items.query({query:"SELECT * FROM c WHERE c.type = @type",parameters:[{name:"@type",value:type}]}).fetchAll();
    return resources;
  },
  async put(doc,ifMatch){
    const {items}=await containers();
    if(ifMatch){
      try{
        const {resource}=await items.item(doc.id,doc.type).replace(doc,{accessCondition:{type:"IfMatch",condition:ifMatch}});
        return resource;
      }catch(e){if(e.code!==404)throw e} // 412 goes up to core; 404 = deleted meanwhile, so store it again below
    }
    const {resource}=await items.items.upsert(doc);
    return resource;
  },
  async remove(type,id){
    const {items}=await containers();
    try{await items.item(id,type).delete()}catch(e){if(e.code!==404)throw e}
  },
  async getAttachment(id){
    const {attachments}=await containers();
    try{const {resource}=await attachments.item(id,id).read();return resource||null}
    catch(e){if(e.code===404)return null;throw e}
  },
  async putAttachment(doc){
    const {attachments}=await containers();
    try{await attachments.items.create(doc)}catch(e){if(e.code!==409)throw e} // 409: already stored (same image)
  },
};

const api=createApi({
  store:cosmosStore,
  settings:process.env,
  sha256:async s=>crypto.createHash("sha256").update(s).digest("hex"),
  newId:()=>crypto.randomUUID(),
});

// Azure HTTP request → core handler → Azure HTTP response
function handler(fn){
  return async(request,context)=>{
    try{
      const principal=parsePrincipal(request.headers.get("x-ms-client-principal"),b=>Buffer.from(b,"base64").toString("utf8"));
      const body=request.method==="PUT"?await request.json().catch(()=>null):null;
      const res=await fn({method:request.method,principal,params:request.params,body});
      const headers={"cache-control":"no-store",...res.headers};
      if(res.base64!==undefined)return {status:res.status,headers:{...headers,"content-type":res.contentType},body:Buffer.from(res.base64,"base64")};
      return res.json===undefined?{status:res.status,headers}:{status:res.status,headers,jsonBody:res.json};
    }catch(e){
      context.error(e);
      return {status:500,headers:{"cache-control":"no-store"},jsonBody:{error:"Server error, see the API logs."}};
    }
  };
}
const http=(name,methods,route,fn)=>app.http(name,{methods,route,authLevel:"anonymous",handler:handler(fn)}); // Static Web Apps does the sign-in
http("config",["GET"],"config",api.config);
http("data",["GET"],"data",api.data);
http("items",["PUT","DELETE"],"items/{collection}/{id}",req=>req.method==="PUT"?api.putItem(req):api.deleteItem(req));
http("attachments",["GET"],"attachments/{id}",api.attachment);
