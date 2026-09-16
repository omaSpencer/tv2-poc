import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { MeilisearchApiError } from 'meilisearch';
import { SearchProjectionWorker } from '../src/search/projection.worker.js';
import { SearchIndexState, SearchState } from '../src/search/worker.state.js';
import { SearchService } from '../src/search/search.service.js';
import { bootstrapIndex } from '../src/search/index-bootstrap.js';
import { validateConfig } from '../src/config.js';
import { topologyNames } from '../src/messaging/topology.js';
import type { MeiliIndexAdapter } from '../src/search/meili.adapter.js';
import type { JetStreamAdapter } from '../src/messaging/jetstream.adapter.js';
import type { DatabaseService } from '../src/database.js';
import type { ContentRepository } from '../src/content/content.repository.js';
import type { SearchRegistry } from '../src/search/search.registry.js';
// @ts-expect-error The demo helper is a native JavaScript script.
import { assertFixtureState } from '../scripts/lib/demo-m4-state.mjs';

const settings = { searchableAttributes: ['title', 'tags', 'summary'], filterableAttributes: ['category'], displayedAttributes: ['id'], sortableAttributes: [] };
const defaults = { searchableAttributes: ['*'], filterableAttributes: [], displayedAttributes: ['*'], sortableAttributes: [] };
const names = topologyNames('M4_REVIEW', 'review.changed');
const config = {NODE_ENV: 'test', PORT: 0, LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/review_test', FEATURE_SEARCH: 'on', NATS_URL: 'nats://localhost:4222', MEILI_A_URL: 'http://localhost:7700', MEILI_A_KEY: 'a', MEILI_B_URL: 'http://localhost:7701', MEILI_B_KEY: 'b'};
const apiError = (status: number) => new MeilisearchApiError(new Response(null, {status}), {message:'injected', code:'internal', type:'internal', link:''});
function baseAdapter() {
  return {alias:'a', indexExists:vi.fn(async()=>true), primaryKey:vi.fn(async()=>'id'), managedSettings:vi.fn(async()=>settings), createIndex:vi.fn(async()=>10), applyManagedSettings:vi.fn(async()=>11), awaitTask:vi.fn(async(uid:number)=>({uid,status:'succeeded',errorCode:null as string | null})), submitDelete:vi.fn(async()=>12)};
}
const event = {eventId:'f8c71d11-013c-4b99-8870-5679b329fd33', schemaVersion:1, eventType:'content.withdrawn', aggregateId:'a8c71d11-013c-4b99-8870-5679b329fd33', aggregateVersion:2, occurredAt:new Date().toISOString(), correlationId:'review', payload:{status:'withdrawn'}};
function harness(adapter = baseAdapter(), workingMs = 100, retryDelaysMs = [2]) {
  let available = true;
  const ack = vi.fn();
  const message = {data:Buffer.from(JSON.stringify(event)), ack, working:vi.fn(), info:{streamSequence:1}, subject:names.subject};
  const consumer = {next:vi.fn(async()=> {
    if (available) { available=false; return message; }
    await new Promise(resolve=>setTimeout(resolve, 2)); return null;
  })};
  const broker = {isConnected:true, consumer:vi.fn(async()=>consumer), consumerInfo:vi.fn(async()=>({config:{ack_policy:'explicit',deliver_policy:'all',filter_subject:names.subject,ack_wait:30_000_000_000}})),publishTo:vi.fn(async()=>({}))};
  const state = new SearchIndexState();
  const w = new SearchProjectionWorker('a', names.durables[0]!, adapter as unknown as MeiliIndexAdapter, state, broker as unknown as JetStreamAdapter, names, {db:{}} as DatabaseService, {findById:vi.fn(async()=>undefined)} as unknown as ContentRepository, {logLevel:'silent',retryDelaysMs,workingMs});
  return {w, state, broker, consumer, ack, adapter};
}

describe('M4 review regressions',()=>{
  it('R01 reacquires a failed consumer and processes the pending event',async()=>{
    const h=harness();
    const dead={next:vi.fn(async()=>{throw new Error('closed');})};
    h.broker.consumer.mockResolvedValueOnce(dead as never);
    h.w.start();
    try {
      await vi.waitFor(()=>expect(h.ack).toHaveBeenCalledOnce());
      expect(h.adapter.submitDelete).toHaveBeenCalledOnce();
      expect(h.broker.publishTo).not.toHaveBeenCalled();
      expect(dead.next).toHaveBeenCalledOnce();
      expect(h.broker.consumer).toHaveBeenCalledTimes(2);
      expect(h.broker.consumerInfo).toHaveBeenCalledTimes(2);
    } finally {await h.w.stop();}
  });
  it.each([new Error('poll network failure'),apiError(429),apiError(503)])('R02 retains an accepted task after %s',async(error)=>{
    const h=harness();
    h.adapter.awaitTask.mockRejectedValueOnce(error);
    h.w.start();
    try {
      await vi.waitFor(()=>expect(h.ack).toHaveBeenCalledOnce());
      expect(h.adapter.submitDelete).toHaveBeenCalledOnce();
      expect(h.adapter.awaitTask.mock.calls.map(args=>args[0])).toEqual([12,12]);
    } finally {await h.w.stop();}
  });
  it('waits the exact retry backoff after a failed submission', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const h = harness(baseAdapter(), 100, [1000]);
    h.adapter.submitDelete.mockRejectedValueOnce(new Error('submission failed'));
    h.w.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(h.adapter.submitDelete).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(999);
      expect(h.adapter.submitDelete).toHaveBeenCalledOnce();
      expect(h.ack).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(h.adapter.submitDelete).toHaveBeenCalledTimes(2);
      expect(h.ack).toHaveBeenCalledOnce();
    } finally {
      const stopped = h.w.stop(0);
      await vi.runAllTimersAsync();
      await stopped;
      random.mockRestore();
      vi.useRealTimers();
    }
  });
  it.each(['off','bootstrapping','halted'] as const)('R03 never routes to B in %s',async status=>{
    const state=new SearchState();state.get('a').state='idle';state.get('a').bootstrapped=true;state.get('b').state=status;state.get('b').bootstrapped=true;
    const a=vi.fn(async()=>{throw new Error('network');});const b=vi.fn(async()=>({ids:[],estimatedTotalHits:0}));
    const service=new SearchService(new ConfigService({LOG_LEVEL:'silent'}),{enabled:true,adapter:(alias:string)=>({search:alias==='a'?a:b})} as unknown as SearchRegistry,state,{} as DatabaseService,{} as ContentRepository);
    await expect(service.search({q:'x',category:null,limit:20,offset:0})).rejects.toMatchObject({code:'search_unavailable'});
    expect(a).toHaveBeenCalledOnce();expect(b).not.toHaveBeenCalled();
  });
  it('R03 routes around initial bootstrap retry, but allows retry after bootstrap',async()=>{
    const state=new SearchState();state.get('a').state='retrying';state.get('b').state='idle';state.get('b').bootstrapped=true;
    const a=vi.fn(async()=>({ids:[],estimatedTotalHits:0}));const b=vi.fn(async()=>({ids:[],estimatedTotalHits:0}));
    const service=new SearchService(new ConfigService({LOG_LEVEL:'silent'}),{enabled:true,adapter:(alias:string)=>({search:alias==='a'?a:b})} as unknown as SearchRegistry,state,{} as DatabaseService,{} as ContentRepository);
    await service.search({q:'x',category:null,limit:20,offset:0});expect(a).not.toHaveBeenCalled();expect(b).toHaveBeenCalledOnce();
    state.get('a').bootstrapped=true;
    await service.search({q:'x',category:null,limit:20,offset:0});expect(a).toHaveBeenCalledOnce();expect(b).toHaveBeenCalledOnce();
  });
  it('R04 refuses default settings on an existing index without changing anything',async()=>{
    const adapter=baseAdapter();adapter.managedSettings.mockResolvedValue(defaults);
    await expect(bootstrapIndex(adapter as unknown as MeiliIndexAdapter)).rejects.toMatchObject({name:'IndexConfigMismatchError'});
    expect(adapter.createIndex).not.toHaveBeenCalled();expect(adapter.applyManagedSettings).not.toHaveBeenCalled();
  });
  it('R04 resumes its own settings task after a lost poll without resubmission',async()=>{
    const adapter=baseAdapter();adapter.indexExists.mockResolvedValueOnce(false);adapter.managedSettings.mockResolvedValue(defaults);
    adapter.awaitTask.mockImplementation(async uid=>{if(uid===11)throw new Error('lost settings poll');return {uid,status:'succeeded',errorCode:null};});
    await expect(bootstrapIndex(adapter as unknown as MeiliIndexAdapter)).rejects.toThrow('lost settings poll');
    adapter.awaitTask.mockImplementation(async uid=>{adapter.managedSettings.mockResolvedValue(settings);return {uid,status:'succeeded',errorCode:null};});
    await expect(bootstrapIndex(adapter as unknown as MeiliIndexAdapter)).resolves.toMatchObject({settingsApplied:true});
    expect(adapter.createIndex).toHaveBeenCalledOnce();expect(adapter.applyManagedSettings).toHaveBeenCalledOnce();
  });
  it('R04 retries a failed settings task only on the index it created', async () => {
    const adapter = baseAdapter();
    adapter.indexExists.mockResolvedValueOnce(false);
    adapter.managedSettings.mockResolvedValue(defaults);
    adapter.awaitTask.mockImplementation(async uid => ({
      uid, status: uid === 11 ? 'failed' : 'succeeded', errorCode: null,
    }));
    await expect(bootstrapIndex(adapter as unknown as MeiliIndexAdapter)).rejects.toMatchObject({ name: 'MeiliTaskFailedError' });
    adapter.awaitTask.mockImplementation(async uid => {
      adapter.managedSettings.mockResolvedValue(settings);
      return { uid, status: 'succeeded', errorCode: null };
    });
    await expect(bootstrapIndex(adapter as unknown as MeiliIndexAdapter)).resolves.toMatchObject({ settingsApplied: true });
    expect(adapter.createIndex).toHaveBeenCalledOnce();
    expect(adapter.applyManagedSettings).toHaveBeenCalledTimes(2);
  });
  it('R05 detects a stale first fixture even when the second fixture agrees',()=>{
    const survivor={id:'second',aggregateVersion:2};const expected=[null,survivor];
    expect(()=>assertFixtureState(expected,expected,[{id:'first'},survivor])).toThrow();
    expect(()=>assertFixtureState(expected,expected,expected)).not.toThrow();
  });
  it('R06 requires NATS for search independently of the relay flag',()=>{
    expect(()=>validateConfig({...config,NATS_URL:undefined,FEATURE_OUTBOX_RELAY:'off'})).toThrow('NATS_URL');
    expect(validateConfig({...config,FEATURE_OUTBOX_RELAY:'off'}).NATS_URL).toBe(config.NATS_URL);
  });
  it.each([10001,30000,60000])('R07 rejects unsafe heartbeat %i at startup',interval=>{
    expect(()=>validateConfig({...config,SEARCH_CONSUMER_WORKING_MS:interval})).toThrow('SEARCH_CONSUMER_WORKING_MS');
  });
  it('R07 checks the real consumer contract even when config validation is bypassed',async()=>{
    const h=harness(baseAdapter(),30000);h.w.start();
    try {await vi.waitFor(()=>expect(h.state.lastErrorCode).toBe('consumer_contract'));expect(h.consumer.next).not.toHaveBeenCalled();}finally{await h.w.stop();}
  });
});
