const {test}=require('node:test');const assert=require('node:assert/strict');const {normalize,open}=require('../lib/toc');
const node=(id,title,parent='II. 사업의 내용')=>({id,title,path:[parent,title]});
test('normalize numbering and punctuation without semantic rewriting',()=>{assert.equal(normalize(' II. 사업의 내용 '),'사업의 내용');assert.equal(normalize('2. 사업의 개요'),'사업의 개요');assert.equal(normalize('사업의 개요'),'사업의 개요');});
test('cancelled navigation never selects a target',async()=>{let calls=0;await assert.rejects(open({mainFrame:{executeJavaScript:()=>calls++}},node('a','a'),()=>false),/취소/);assert.equal(calls,0);});
