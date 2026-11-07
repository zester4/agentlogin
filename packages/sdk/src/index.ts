import { ApprovedGrantSchema, GrantRequestSchema, type ApprovedGrant, type GrantRequest } from "@agentlogin/contracts";
export type AgentLoginClientOptions = {baseUrl:string;agentToken:string;fetch?:typeof fetch};
export class AgentLoginClient {
  private readonly baseUrl:string; private readonly token:string; private readonly fetcher:typeof fetch;
  constructor(options:AgentLoginClientOptions) {
    this.baseUrl=options.baseUrl.replace(/\/$/,""); this.token=options.agentToken; this.fetcher=options.fetch??fetch;
  }
  async requestGrant(request:GrantRequest):Promise<ApprovedGrant|{status:"pending_approval"|"denied";request_id:string}> {
    const input=GrantRequestSchema.parse(request);
    const response=await this.fetcher(`${this.baseUrl}/v1/grants`,{
      method:"POST",headers:{authorization:`Bearer ${this.token}`,"content-type":"application/json"},body:JSON.stringify(input)
    });
    if(!response.ok) throw new Error(`AgentLogin request failed (${response.status})`);
    const data:unknown=await response.json();
    if(typeof data==="object"&&data!==null&&"status" in data&&data.status==="approved") return ApprovedGrantSchema.parse(data);
    if(typeof data==="object"&&data!==null&&"status" in data&&(data.status==="pending_approval"||data.status==="denied")&&"request_id" in data&&typeof data.request_id==="string")
      return data as {status:"pending_approval"|"denied";request_id:string};
    throw new Error("AgentLogin returned an invalid grant response");
  }
}
