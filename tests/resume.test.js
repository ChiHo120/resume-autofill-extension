import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSupplements,missingSupplements,mergePending,informationSummary} from '../shared/resume.js';
import {validateResume} from '../shared/api.js';
const age={id:'age',label:'年龄',section:'基本信息',reason:'请补充年龄',value:' 22 '};

test('supplements accept ordinary text and reject malformed or oversized backups',()=>{
 assert.equal(validateSupplements([age])[0].value,'22');
 assert.throws(()=>validateSupplements([age,age]));
 for(const value of [null,{},[{...age,value:22}],[{...age,label:''}],[{...age,value:'x'.repeat(10001)}],Array(201).fill(age)]) assert.throws(()=>validateSupplements(value));
 assert.equal(validateResume(null,null,[age]).supplements[0].value,'22');
 assert.throws(()=>validateResume(null,null,[{...age,value:'  '}]));
});

test('missing fields stay distinct across sections and repeated labels, and deduplicate on rescans',()=>{
 const fields=[{id:'a',label:'学校',section:'教育'},{id:'b',label:'学校',section:'教育'},{id:'c',label:'学校',section:'工作'},{id:'d',label:'同意条款',protected:true}];
 const missing=fields.map(f=>({fieldId:f.id,reason:'待补充'}));
 const items=missingSupplements(fields,missing);
 assert.equal(items.length,3);assert.equal(new Set(items.map(i=>i.id)).size,3);
 assert.match(items[1].section,/第 2 项/);
 const rescanned=missingSupplements(fields.map(f=>({...f,id:'new-'+f.id})),missing.map(m=>({...m,fieldId:'new-'+m.fieldId})));
 assert.deepEqual(mergePending(items,rescanned),items);
 assert.equal(missingSupplements(fields,[missing[1]])[0].id,items[1].id);
});

test('summary preserves PDF and legacy facts, includes confirmed answers, excludes empty suggestions',()=>{
 const summary=informationSummary({basic:{fullName:'Demo'},education:[{school:'Example University'}]},{text:'PDF original text'},[age,{id:'salary',label:'薪资',value:'',reason:'invented salary'}]);
 assert.match(summary,/年龄：22/);assert.match(summary,/PDF original text/);
 assert.match(summary,/姓名：Demo/);assert.match(summary,/学校：Example University/);
 assert.doesNotMatch(summary,/invented salary|薪资/);
 assert.ok(summary.indexOf('年龄')<summary.indexOf('PDF original text'));
 assert.equal(informationSummary(null,null,[]),'');
});
