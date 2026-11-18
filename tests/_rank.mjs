import { readFileSync } from 'node:fs'
globalThis.fetch = async () => ({ ok:true, status:200, json: async () => JSON.parse(readFileSync('static/data/graph-compact.json','utf8')) })
const { loadGraph, findPaths, setFlowCohorts } = await import('../src/lib/pathEngine.js')
const src = readFileSync('src/lib/data/flows.ts','utf8')
const cohorts = new Map(); let i=0
for (const m of src.matchAll(/tables:\s*\[([^\]]+)\]/g)) { const id=i++; for (const raw of m[1].split(',')) { const n=raw.trim().replace(/^['"]|['"]$/g,''); if(n&&!cohorts.has(n))cohorts.set(n,id) } }
await loadGraph(); setFlowCohorts(cohorts)
const pairs=[['SalesTable','CustTrans'],['InventTable','CustTable'],['SalesTable','CustTable'],['PurchLine','SalesLine'],['InventJournalTrans','VendTable'],['SalesLine','TaxTable'],['CustTrans','LedgerJournalTrans'],['VendInvoiceJour','LedgerJournalTrans'],['SalesTable','VendTable'],['ProjTable','CustTable']]
for (const rb of ['evidence','story']) {
  console.log('\n==== rankBy='+rb)
  for (const [a,b] of pairs) {
    const t=Date.now()
    const r=findPaths(a,b,{maxHops:4,maxResults:50,rankBy:rb})
    const top=r.results[0]
    console.log(`${a}→${b}: ${r.results.length} res, ${Date.now()-t}ms, top=[${top?top.tierFloor:'-'}] ${top?top.key:'NONE'} (${top?top.hops:0}h)`)
  }
}
