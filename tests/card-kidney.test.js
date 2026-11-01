const test=require('node:test');
const assert=require('node:assert/strict');
const kidney=require('../kidney-function');
const bars=require('../kidney-bars-adapter');
const lab=require('../lab-markers');

test('CKD-EPI 2021 matches NKF reference cases and categories',()=>{
    const male=kidney.calculate({sex:'male',age:90,creatinine:'1.50',unit:'mg/dL'});
    const female=kidney.calculate({sex:'female',age:90,creatinine:'1.50',unit:'mg/dL'});
    assert.equal(Math.round(male.egfr),44);
    assert.equal(Math.round(female.egfr),33);
    assert.equal(male.category.code,'G3b');
    assert.equal(female.category.code,'G3b');
    assert.equal(kidney.category(90).code,'G1');
    assert.equal(kidney.category(60).code,'G2');
    assert.equal(kidney.category(45).code,'G3a');
    assert.equal(kidney.category(30).code,'G3b');
    assert.equal(kidney.category(15).code,'G4');
    assert.equal(kidney.category(14.9).code,'G5');
});

test('Cockcroft-Gault uses weight, but CKD-EPI does not',()=>{
    const a=kidney.calculate({sex:'Мужской',age:60,weight:70,creatinine:88.4,unit:'мкмоль/л'});
    const b=kidney.calculate({sex:'Мужской',age:60,weight:100,creatinine:88.4,unit:'мкмоль/л'});
    assert.equal(a.egfr,b.egfr);
    assert(Math.abs(a.crcl-77.7778)<0.01);
    assert(b.crcl>a.crcl);
    const female=kidney.calculate({sex:'Женский',age:60,weight:70,creatinine:88.4,unit:'мкмоль/л'});
    assert(Math.abs(female.crcl-a.crcl*0.85)<0.01);
});

test('BARS mmol/L creatinine converts to the same value as µmol/L',()=>{
    const mmol=kidney.calculate({sex:'female',age:60,weight:70,creatinine:'0.061',unit:'ммоль/л'});
    const micromol=kidney.calculate({sex:'female',age:60,weight:70,creatinine:'61',unit:'мкмоль/л'});
    assert(Math.abs(mmol.creatinineMgDl-61/88.4)<1e-12);
    assert.equal(mmol.egfr,micromol.egfr);
    assert.equal(mmol.crcl,micromol.crcl);
});

test('missing or invalid units and pediatric age never create a result',()=>{
    for(const input of [
        {sex:'male',age:17,weight:70,creatinine:80,unit:'мкмоль/л'},
        {sex:'male',age:60,weight:70,creatinine:80,unit:''},
        {sex:'',age:60,weight:70,creatinine:80,unit:'мкмоль/л'},
        {sex:'male',age:60,weight:70,creatinine:0,unit:'мкмоль/л'}
    ]){const result=kidney.calculate(input);assert.equal(result.egfr,null);assert.equal(result.crcl,null);}
    const partial=kidney.calculate({sex:'male',age:60,creatinine:88.4,unit:'мкмоль/л'});
    assert(partial.egfr>0);assert.equal(partial.crcl,null);
    assert.equal(kidney.ageAt('29.02.2023',new Date(2026,9,24)),NaN);
});

test('BARS result parser accepts a serum creatinine with explicit unit, not urine',()=>{
    const rows=[
        {RES:'Креатинин в моче: 8 ммоль/л',SREG_DATE:'22.10.2026'},
        {RES:'<span>Глюкоза: 5.1 ммоль/л</span>;\n<span>Креатинин: 96,4 мкмоль/л</span>',SREG_DATE:'23.10.2026',SERVICE_NAME:'Биохимия'}
    ];
    assert.deepEqual(bars.creatinineFromRows(rows),{creatinine:'96.4',creatinineUnit:'мкмоль/л',creatinineDate:'23.10.2026',labService:'Биохимия'});
    assert.deepEqual(bars.creatinineFromRows([{RES:'Креатинин: 100'}]),{});
    assert.deepEqual(bars.creatinineFromRows([{RES:'Амилаза общая: 47,0 Ед/л ; Креатинин: 0,061 ммоль/л ; Мочевина: 5 ммоль/л ;',SREG_DATE:'24.10.2026'}]),
        {creatinine:'0.061',creatinineUnit:'ммоль/л',creatinineDate:'24.10.2026',labService:''});
});

test('hemoglobin from BARS is reported in g/L with the requested color thresholds',()=>{
    const rows=[{RES:'Лейкоциты: 5,40 10^9/л ; <span style="color:red">Гемоглобин: 129,0 г/л</span> ; Гематокрит: 38,0 % ;',SREG_DATE:'24.10.2026'}];
    assert.deepEqual(bars.hemoglobinFromRows(rows),{hemoglobin:'129.0',hemoglobinUnit:'г/л',hemoglobinDate:'24.10.2026',hemoglobinService:''});
    assert.equal(lab.hemoglobinGL('7,5','г/дл'),75);
    assert.equal(lab.hemoglobinTone(74.9),'hb-low');
    assert.equal(lab.hemoglobinTone(75),'hb-borderline');
    assert.equal(lab.hemoglobinTone(100),'hb-borderline');
    assert.equal(lab.hemoglobinTone(100.1),'');
    assert(Number.isNaN(lab.hemoglobinGL('129','ммоль/л')));
});

test('glucose from BARS requires a blood result with units and uses fasting-oriented colors',()=>{
    const rows=[
        {RES:'Глюкоза в моче: 8,0 ммоль/л',SREG_DATE:'23.10.2026'},
        {RES:'Глюкоза: 6,40 ммоль/л ; Креатинин: 0,061 ммоль/л ;',SREG_DATE:'24.10.2026',SERVICE_NAME:'Биохимия'}
    ];
    assert.deepEqual(bars.glucoseFromRows(rows),{glucose:'6.40',glucoseUnit:'ммоль/л',glucoseDate:'24.10.2026',glucoseService:'Биохимия'});
    assert.deepEqual(bars.glucoseFromRows([{RES:'Глюкоза: 6,4'}]),{});
    assert(Math.abs(lab.glucoseMmolL('100','mg/dL')-100/18.0182)<1e-12);
    assert(Number.isNaN(lab.glucoseMmolL('6,4','г/л')));
    assert.equal(lab.glucoseTone(3.89),'glucose-low');
    assert.equal(lab.glucoseTone(3.9),'');
    assert.equal(lab.glucoseTone(5.59),'');
    assert.equal(lab.glucoseTone(5.6),'glucose-borderline');
    assert.equal(lab.glucoseTone(6.9),'glucose-borderline');
    assert.equal(lab.glucoseTone(7),'glucose-high');
});

test('BARS constitution parser requires mass in kg',()=>{
    assert.deepEqual(bars.weightFromRows([{ANTHROP_NAME:'Рост',A_VALUE:'172',MEAS:'см'},{ANTHROP_NAME:'Масса тела',A_VALUE:'72,5',MEAS:'кг'}]),{weight:'72.5',weightSource:'Общие сведения'});
    assert.deepEqual(bars.weightFromRows([{ANTHROP_NAME:'Вес',A_VALUE:'59',MEAS:'кг'}]),{weight:'59',weightSource:'Общие сведения'});
    assert.deepEqual(bars.weightFromRows([{ANTHROP_NAME:'Масса тела',A_VALUE:'72',MEAS:'фунт'}]),{});
});

test('an open BARS laboratory window is read before creating a hidden duplicate',async()=>{
    const prior={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle,openWindow:globalThis.openWindow,closeWindow:globalThis.closeWindow};
    const vars={AGENT:'7',PERSMEDCARD:'11',HH_ID:'19',DISEASECASE:'31'};
    const historyPage={getVar:name=>vars[name],getCaption:name=>({PAT_SEX:'Женский',PAT_BDATE:'02.03.1980'})[name]||''};
    const history={form:{page:historyPage},isConnected:true,getBoundingClientRect:()=>({width:0,height:0})};
    const labPage={getVar:name=>vars[name],getDataSet:()=>({data:[{RES:'Гемоглобин: 129,0 г/л ; Глюкоза: 6,40 ммоль/л ; Амилаза: 47 Ед/л ; Креатинин: 0,061 ммоль/л ;',SREG_DATE:'24.10.2026'}]})};
    const labWindow={form:{page:labPage}};
    const opened=[];
    globalThis.document={querySelectorAll:selector=>selector==='.hosp_history_new'?[history]:selector==='.wrap_analyses'?[labWindow]:[]};
    globalThis.getComputedStyle=()=>({visibility:'visible'});
    globalThis.openWindow=options=>{opened.push(options.name);return {destroyed:false,getDataSet:()=>({data:[],setData(){}}),refreshDataSet(){}};};
    globalThis.closeWindow=()=>{};
    try{
        const result=await bars.read({timeout:10});
        assert.equal(result.creatinine,'0.061');
        assert.equal(result.creatinineUnit,'ммоль/л');
        assert.equal(result.hemoglobin,'129.0');
        assert.equal(result.glucose,'6.40');
        assert.equal(result.labHistoryRowCount,1);
        assert.deepEqual(result.labHistory.hemoglobin,[{value:'129.0',unit:'г/л',date:'24.10.2026',service:''}]);
        assert.deepEqual(result.labHistory.creatinine,[{value:'0.061',unit:'ммоль/л',date:'24.10.2026',service:''}]);
        assert.deepEqual(result.labHistory.glucose,[{value:'6.40',unit:'ммоль/л',date:'24.10.2026',service:''}]);
        assert(!opened.includes('ArmPatientsInDep/Wrappers/analyses'));
    }finally{for(const [name,value] of Object.entries(prior)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}
});

test('read-only BARS adapter uses one history identity and closes both temporary forms',async()=>{
    const prior={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle,openWindow:globalThis.openWindow,closeWindow:globalThis.closeWindow};
    const vars={AGENT:'7',PERSMEDCARD:'11',HH_ID:'19',HH_DEP_ID:'23',DISEASECASE:'31'};
    const historyPage={getVar:name=>vars[name],getCaption:name=>({PAT_SEX:'Мужской',PAT_BDATE:'02.03.1980'})[name]||''};
    const history={form:{page:historyPage},isConnected:true,getBoundingClientRect:()=>({width:300,height:300})};
    const opened=[],closed=[];
    globalThis.document={querySelectorAll:selector=>selector==='.hosp_history_new'?[history]:[]};
    globalThis.getComputedStyle=()=>({visibility:'visible'});
    globalThis.openWindow=options=>{
        opened.push(options);
        const info=options.name==='ArmPatientsInDep/patients_information';
        const ds={data:[],setData(rows){this.data=rows;}};
        return {destroyed:false,getDataSet:()=>ds,setVar(){},refreshDataSet(){
            queueMicrotask(()=>ds.setData(info?[{ANTHROP_NAME:'Масса тела',A_VALUE:'75',MEAS:'кг'},{ANTHROP_NAME:'Рост',A_VALUE:'1,75',MEAS:'м'}]:[{RES:'Креатинин: 88,4 мкмоль/л',SREG_DATE:'22.10.2026'}]));
        }};
    };
    globalThis.closeWindow=(_unused,page)=>closed.push(page);
    try{
        const result=await bars.read({timeout:500});
        assert.equal(result.sex,'Мужской');
        assert.equal(result.birthDate,'02.03.1980');
        assert.equal(result.weight,'75');
        assert.equal(result.height,'175');
        assert.equal(result.creatinine,'88.4');
        assert.deepEqual(opened.map(x=>x.name),['ArmPatientsInDep/patients_information','ArmPatientsInDep/Wrappers/analyses']);
        assert(opened.every(x=>x.vars.HH_ID==='19'&&x.vars.PERSMEDCARD==='11'));
        assert.equal(closed.length,2);
        history.getBoundingClientRect=()=>({width:0,height:0}); // Hidden under the lab modal.
        const underModal=await bars.read({timeout:500});
        assert.equal(underModal.creatinine,'88.4');
    }finally{for(const [name,value] of Object.entries(prior)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}
});


test('BMI uses kilograms and centimetres, independently of creatinine and sex',()=>{
    const result=kidney.bodyMassIndex({weight:'72,5',height:'172',age:46});
    assert(Math.abs(result.value-24.50649)<0.00001);
    assert.equal(result.category.label,'Норма');
    assert.equal(kidney.bodyMassIndex({weight:120,height:200,age:18}).category.label,'Ожирение I степени');
    for(const [value,label] of [[15.99,'Дефицит массы III степени'],[16,'Дефицит массы II степени'],[16.99,'Дефицит массы II степени'],[17,'Дефицит массы I степени'],[18.49,'Дефицит массы I степени'],[18.5,'Норма'],[24.99,'Норма'],[25,'Избыток массы'],[29.99,'Избыток массы'],[30,'Ожирение I степени'],[34.99,'Ожирение I степени'],[35,'Ожирение II степени'],[39.99,'Ожирение II степени'],[40,'Ожирение III степени']])
        assert.equal(kidney.bodyMassIndex({weight:value*4,height:200,age:45}).category.label,label);
});
test('BMI rejects absent, ambiguous or invalid measurements; adult colors require an adult age',()=>{
    for(const [weight,height] of [['',172],[75,''],[0,172],[75,0],[75,1.72],[75,251],[401,172],['75 кг',172]]){
        const result=kidney.bodyMassIndex({weight,height,age:45});assert.equal(result.value,null);assert.equal(result.category,null);
    }
    for(const age of ['',17,121]){
        const result=kidney.bodyMassIndex({weight:100,height:160,age});assert.equal(result.category,null);assert(result.value>0);
    }
});
test('BARS height parser requires height with explicit centimetres or metres',()=>{
    assert.deepEqual(bars.heightFromRows([{ANTHROP_NAME:'Рост',A_VALUE:'172,5',MEAS:'см'}]),{height:'172.5',heightSource:'Общие сведения'});
    assert.deepEqual(bars.heightFromRows([{ANTHROP:'Рост (м)',A_VALUE:'1,725',MEAS:'м'}]),{height:'172.5',heightSource:'Общие сведения'});
    for(const row of [{ANTHROP_NAME:'Масса тела',A_VALUE:'172',MEAS:'см'},{ANTHROP_NAME:'Рост',A_VALUE:'172',MEAS:''},{ANTHROP_NAME:'Рост',A_VALUE:'5.7',MEAS:'ft'},{ANTHROP_NAME:'Рост',A_VALUE:'1.72',MEAS:'см'}])assert.deepEqual(bars.heightFromRows([row]),{});
});
