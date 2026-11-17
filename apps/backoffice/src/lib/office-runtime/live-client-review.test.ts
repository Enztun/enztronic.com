import {createServer} from 'node:http';
import {once} from 'node:events';
import {describe, expect, it} from 'vitest';
import {createOpenAIProvider, interpretResponse, parseUsage, requestBody, type LiveModelCall} from './openai';

const call: LiveModelCall = {model:'gpt-6-luna',instructions:'Internal draft only.',input:'Test brief.',schemaName:'review_test',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},maxOutputTokens:6000,reasoningEffort:'low',metadata:{},clientRequestId:'office-client-review'};
const key = `sk-proj-${'z'.repeat(40)}`;
const usage = () => ({input_tokens:1000,output_tokens:200,total_tokens:1200,input_tokens_details:{cached_tokens:100,cache_write_tokens:300,cache_write_tokens_details:{ttl_30m_tokens:200,ttl_12h_tokens:100}},output_tokens_details:{reasoning_tokens:50}});
const response = () => ({id:'resp_review',model:call.model,status:'completed',service_tier:'default',usage:usage(),output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]});

describe('review regressions: billing evidence and transport', () => {
  it('requires complete disjoint exact token accounting, including cache write lifetimes', () => {
    expect(parseUsage(usage())).toEqual({inputTokens:1000,outputTokens:200,cachedTokens:100,cacheWriteTokens:300,cacheWrite12hTokens:100,reasoningTokens:50});
    const missingCache = usage(); delete (missingCache.input_tokens_details as Partial<typeof missingCache.input_tokens_details>).cached_tokens;
    const missingWrite = usage(); delete (missingWrite.input_tokens_details as Partial<typeof missingWrite.input_tokens_details>).cache_write_tokens;
    const missingLifetime = usage(); delete (missingLifetime.input_tokens_details as Partial<typeof missingLifetime.input_tokens_details>).cache_write_tokens_details;
    const missingReasoning = usage(); delete (missingReasoning.output_tokens_details as Partial<typeof missingReasoning.output_tokens_details>).reasoning_tokens;
    const malformed = [missingCache,missingWrite,missingLifetime,missingReasoning,
      {...usage(),total_tokens:1199}, {...usage(),input_tokens:-1}, {...usage(),output_tokens:0.5},
      {...usage(),input_tokens:Number.NaN}, {...usage(),output_tokens:Number.POSITIVE_INFINITY},
      {...usage(),total_tokens:Number.MAX_SAFE_INTEGER+1},
      {...usage(),input_tokens_details:{...usage().input_tokens_details,cached_tokens:900}},
      {...usage(),input_tokens_details:{...usage().input_tokens_details,cache_write_tokens_details:{ttl_30m_tokens:200,ttl_12h_tokens:101}}},
      {...usage(),output_tokens_details:{reasoning_tokens:201}},
    ];
    for (const value of malformed) {
      expect(parseUsage(value)).toBeNull();
      expect(interpretResponse({...response(),usage:value},'req_review',call.model)).toMatchObject({kind:'unknown',code:'response_without_usage'});
    }
  });
  it('allows an omitted lifetime breakdown only when explicitly zero tokens were written', () => {
    expect(parseUsage({...usage(),input_tokens_details:{cached_tokens:0,cache_write_tokens:0}})).toMatchObject({cacheWriteTokens:0,cacheWrite12hTokens:0});
    expect(parseUsage({...usage(),input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_12h_tokens:1,ttl_30m_tokens:0}}})).toBeNull();
  });
  it('does not infer the effective model or processing tier from what was requested', () => {
    expect(interpretResponse(response(),'req_review',call.model)).toMatchObject({kind:'completed'});
    expect(interpretResponse({...response(),model:'other-model'},'req_review',call.model)).toMatchObject({kind:'unknown',code:'unexpected_response_model'});
    expect(interpretResponse({...response(),model:undefined},'req_review',call.model)).toMatchObject({kind:'unknown',code:'unexpected_response_model'});
    expect(interpretResponse({...response(),service_tier:undefined},'req_review',call.model)).toMatchObject({kind:'unknown',code:'missing_response_service_tier'});
    expect(interpretResponse({...response(),service_tier:'fast'},'req_review',call.model)).toMatchObject({kind:'unusable',code:'unexpected_response_service_tier',usage:{inputTokens:1000},serviceTier:'fast'});
    expect(interpretResponse({...response(),service_tier:'future-more-expensive-tier'},'req_review',call.model)).toMatchObject({kind:'unknown',code:'unpriced_response_service_tier'});
  });
  it.each([302,307,308,408,409,500,503])('does not release or automatically retry an uncertain HTTP %i outcome', async status => {
    let calls=0;
    const provider=createOpenAIProvider({apiKey:key,fetch:(async()=>{calls++;return new Response('{}',{status});}) as typeof fetch});
    expect(await provider.create(call)).toMatchObject({kind:'unknown'});
    expect(calls).toBe(1);
  });
  it('rejects a count payload without the documented response discriminator', async () => {
    const provider=createOpenAIProvider({apiKey:key,fetch:(async()=>new Response('{"input_tokens":1000}',{status:200})) as typeof fetch});
    expect(await provider.countInputTokens(call)).toEqual({ok:false,code:'count_invalid_response',configuration:false});
  });
  it('bounds both HTTP operations by the remaining attempt time without sending the deadline', async () => {
    let requests=0;
    const provider=createOpenAIProvider({apiKey:key,fetch:(async(_url,init)=>{
      requests++;
      return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}));
    }) as typeof fetch});
    const expiring={...call,timeoutMs:10};
    expect(await provider.countInputTokens(expiring)).toMatchObject({ok:false,code:'count_timeout'});
    expect(await provider.create(expiring)).toMatchObject({kind:'unknown',code:'timeout'});
    expect(requests).toBe(2);
    for(const purpose of ['count','create'] as const)expect(requestBody(expiring,purpose)).not.toHaveProperty('timeoutMs');
    expect(await provider.create({...call,timeoutMs:0})).toMatchObject({kind:'rejected',status:0,retryable:false});
    expect(await provider.countInputTokens({...call,timeoutMs:-1})).toMatchObject({ok:false});
    expect(requests).toBe(2);
  });
  it('never follows a real HTTP redirect for either a token count or model create', async () => {
    const requests:string[]=[];
    const server=createServer((req,res)=>{requests.push(req.url??'');res.writeHead(307,{location:'/redirect-target'});res.end();});
    try {
      server.listen(0,'127.0.0.1'); await once(server,'listening');
      const address=server.address(); if (!address||typeof address==='string')throw new Error('Expected loopback listener');
      const provider=createOpenAIProvider({apiKey:key,baseUrl:`http://127.0.0.1:${address.port}`});
      expect(await provider.countInputTokens(call)).toMatchObject({ok:false});
      expect(await provider.create(call)).toMatchObject({kind:'unknown'});
      expect(requests).toEqual(['/responses/input_tokens','/responses']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });
});
