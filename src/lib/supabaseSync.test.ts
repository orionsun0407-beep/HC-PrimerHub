import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),row:{} as any}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:mocks.rpc,from:mocks.from})}));
beforeEach(()=>{
 vi.resetModules();vi.stubEnv('VITE_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('VITE_SUPABASE_ANON_KEY','test-public-key');
 mocks.rpc.mockReset();mocks.from.mockReset();mocks.row={id:'primer-uuid',user_id:'account',revision:7,name:'original'};
 mocks.from.mockImplementation(()=>{const chain:any={};for(const method of ['select','eq','is','order'])chain[method]=()=>chain;chain.single=async()=>({data:{...mocks.row,revision:9},error:null});chain.then=(resolve:any)=>resolve({data:[mocks.row],error:null});return chain});
});
it('keeps the loaded revision when a later read sees another edit',async()=>{
 const api=await import('./supabase');await api.loadPrimers('account');mocks.rpc.mockResolvedValue({data:{status:'conflict',row:{revision:9}},error:null});
 await expect(api.updatePrimer('account','primer-uuid',{name:'local edit'})).rejects.toThrow('其他设备修改');
 expect(mocks.rpc).toHaveBeenCalledWith('hc_wb_apply',expect.objectContaining({expected_revision:7,operation:'upsert',record_id:'primer-uuid',payload:expect.objectContaining({name:'local edit'})}));
});
it('sends versioned soft deletions through the RPC',async()=>{
 const api=await import('./supabase');await api.loadPrimers('account');mocks.rpc.mockResolvedValue({data:{status:'ok',row:{revision:8,deleted_at:'today'}},error:null});
 await api.deletePrimer('account','primer-uuid');expect(mocks.rpc).toHaveBeenCalledWith('hc_wb_apply',expect.objectContaining({expected_revision:7,operation:'delete'}));
});
