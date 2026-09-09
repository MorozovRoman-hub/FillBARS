'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../diary-core');
test('реальные календарные даты и время проверяются до отправки',()=>{
    assert.equal(C.validDate('2026-02-30'),false);
    assert.equal(C.validDate('2024-02-29'),true);
    assert.equal(C.validTime('24:00'),false);
    assert.equal(C.validTime('23:59'),true);
});
test('числовая проверка АД остаётся только для генератора демонстрационных значений',()=>{
    assert.equal(C.validateVitals({...C.DEFAULTS,pressure:'80/120'})[0].field,'pressure');
    assert.equal(C.validateVitals({...C.DEFAULTS,pressure:'80/80'})[0].field,'pressure');
    assert.deepEqual(C.pressure('120 / 80'),[120,80]);
});
test('новая запись наследует правки; предыдущая не изменяется',()=>{
    const defaults={...C.DEFAULTS,temperature:'37,1',pressure:'135/85'};
    const a=C.createRow({defaults});
    const b=C.createRow({defaults,previous:a});
    b.vitals.temperature='36,9';
    assert.equal(a.vitals.temperature,'37,1');
    assert.equal(b.vitals.pressure,'135/85');
});
test('варианты выбираются без соседних одинаковых текстов, даже при дубликатах в библиотеке',()=>{
    const profile={variants:[{id:'a',diary:'Один',examination:'План A',treatment:'Лечение A'},{id:'b',diary:'Два',examination:'План B',treatment:'Лечение B'},{id:'c',diary:' Один ',examination:'',treatment:''}]};
    let prev='Один';
    for(let i=0;i<50;i++){const next=C.chooseVariant(profile,prev,()=>0);assert.notEqual(C.norm(next.diary),prev);prev=C.norm(next.diary);}
    assert.equal(C.chooseVariant({variants:[profile.variants[0]]},'Один').diary,'Один');
});
test('демонстрационный разброс ограничен и сосредоточен около исходного',()=>{
    const spread={temperature:.3,systolic:20,diastolic:20,pulse:10,respiration:2};
    const counts={near:0,far:0};
    for(let i=0;i<4000;i++){
        const x=C.sampleVitals(C.DEFAULTS,spread);
        const [s,d]=C.pressure(x.pressure);
        assert(s>=100&&s<=140&&d>=60&&d<=100&&s>d);
        assert(Math.abs(C.number(x.temperature)-36.6)<.301);
        assert(Math.abs(Number(x.respiration)-16)<=2);
        if(Math.abs(s-120)<=5)counts.near++;if(Math.abs(s-120)>=15)counts.far++;
    }
    assert(counts.near>counts.far*5);
});
test('подобранные показатели манекена требуют подтверждения перед отправкой',()=>{
    const row=C.createRow({date:'2026-09-01',time:'08:00'});
    row.diary='Проверенный текст';
    assert(C.validateRow(row,{forSending:true}).some(e=>e.field==='reviewed'));
    row.vitals=C.sampleVitals(C.DEFAULTS,C.DEFAULT_SPREAD);
    row.reviewed=true;row.date='2099-01-01';
    assert.deepEqual(C.validateRow(row,{forSending:true}),[]);
});

test('все показатели передаются как свободный текст без разбора и нормализации',()=>{
    const vitals={temperature:'36.6 °C',pressure:'120/80 мм рт. ст.',pulse:'80–120, аритмичный; ЭКС',respiration:'16; SpO2 98% на атмосферном воздухе'};
    const row={...C.createRow({date:'2099-01-01',time:'23:59'}),vitals,diary:'Текст',reviewed:true};
    assert.deepEqual(C.validateRow(row,{forSending:true}),[]);
    const fields=C.fields(row);
    assert.equal(fields.TEMPERATURE,vitals.temperature);assert.equal(fields.AD,vitals.pressure);
    assert.equal(fields.THSS,vitals.pulse);assert.equal(fields.THD,vitals.respiration);
    row.vitals={temperature:'',pressure:'не измерено',pulse:'60 + ЭКС',respiration:'произвольный текст'};
    assert.deepEqual(C.validateRow(row,{forSending:true}),[]);
    assert.equal(C.fields(row).TEMPERATURE,'');
});
test('ограничение 4000 символов и дубли времени проверяются',()=>{
    const row=C.createRow();row.diary='x'.repeat(4001);
    assert(C.validateRow(row).some(e=>e.field==='diary'));
    row.diary='Текст';
    assert(C.validateQueue([row,C.clone(row)]).some(e=>e.message.includes('Две записи')));
});
test('импорт отклоняет повреждённые структуры и не интерпретирует HTML',()=>{
    assert.throws(()=>C.cleanLibrary({profiles:[]}));
    assert.throws(()=>C.cleanLibrary({type:'fillbars-card-templates',version:1,profiles:[{name:'x',variants:[{diary:'a'}]}]}));
    const library=C.cleanLibrary({type:'fillbars-card-templates',version:1,profiles:[{name:'<script>alert(1)</script>',variants:[{diary:'<b>текст</b>',examination:'-',treatment:''}]}]});
    assert.equal(library.profiles[0].variants[0].diary,'<b>текст</b>');
});
test('поля БАРС сопоставлены по смысловым именам, пустой план очищается',()=>{
    const row=C.createRow({date:'2026-09-01',time:'12:00'});row.diary='Текст';
    const fields=C.fields(row);
    assert.equal(fields.VISIT_DATE,'01.09.2026');
    assert.equal(fields.TEMPERATURE,'36,6');
    assert.equal(fields.STAC_PLAN,'');
    assert.equal(Object.keys(fields).length,9);
});

test('свободная запись копирует все три текста и показатели без общей ссылки и подтверждения',()=>{
    const a={...C.createRow(),diary:'Ручной дневник',examination:'',treatment:'Ручной план',reviewed:true};
    a.vitals.pulse='60 + ЭКС';
    const b=C.createRow({previous:a,time:'12:00'});
    assert.equal(b.diary,a.diary);assert.equal(b.examination,'');assert.equal(b.treatment,a.treatment);
    assert.equal(b.vitals.pulse,'60 + ЭКС');assert.equal(b.reviewed,false);assert.notEqual(a.id,b.id);
    b.diary='Другая запись';b.vitals.pulse='80';assert.equal(a.diary,'Ручной дневник');assert.equal(a.vitals.pulse,'60 + ЭКС');
});

test('наследование подобранных показателей не наследует подтверждение',()=>{
    const a={...C.createRow({autoPick:true}),diary:'Модельный текст',reviewed:true};
    const b=C.createRow({previous:a});
    assert.deepEqual(b.vitals,a.vitals);assert.equal(b.reviewed,false);
    assert(C.validateRow(b,{forSending:true}).some(error=>error.field==='reviewed'));
});

const genderProfile=()=>({id:'p',name:'Учебный шаблон',genderPairs:[{id:'1',male:'больного',female:'больной'},{id:'2',male:'пациент',female:'пациентка'}],variants:[
    {id:'a',title:'Первый',diary:'Состояние больной тяжёлое. Пациент осмотрен(а). Тяжелобольной.',examination:'Обследование больного',treatment:'Рекомендации для больного'},
    {id:'b',title:'Второй',diary:'Пациент: повторный осмотр.',examination:'',treatment:''}
]});

test('род предполагается по отчеству, неоднозначное имя не угадывается',()=>{
    assert.equal(C.inferGender('Учебная Анна Петровна'),'female');
    assert.equal(C.inferGender('Учебный Пётр Ильич'),'male');
    assert.equal(C.inferGender('Учебная Анна Ильинична'),'female');
    assert.equal(C.inferGender('Учебный Петр Петрович'),'male');
    for(const name of ['',undefined,'Саша','Иванова Саша','Учебный Саша Ким'])assert.equal(C.inferGender(name),'');
});

test('пары рода автоматически заменяют целые слова в трёх текстах и сохраняют исходный шаблон',()=>{
    const profile=genderProfile(),original=structuredClone(profile);
    const male=C.renderVariant(profile,profile.variants[0],'male'),female=C.renderVariant(profile,profile.variants[0],'female');
    assert(male.diary.startsWith('Состояние больного'));assert(female.diary.startsWith('Состояние больной'));
    assert(female.diary.includes('Пациентка осмотрен(а). Тяжелобольной.'));
    assert.equal(female.examination,'Обследование больной');assert.equal(male.treatment,'Рекомендации для больного');
    assert.deepEqual(profile,original);
    assert.throws(()=>C.renderVariant(profile,profile.variants[0],''),/Выберите/);
});

test('выбор вариантов избегает повторов после подстановки рода',()=>{
    const profile=genderProfile();
    const first=C.createRow({profile,gender:'female',random:()=>0});
    const next=C.createRow({previous:first,profile,gender:'female',random:()=>0});
    assert.notEqual(first.diary,next.diary);assert.equal(next.variantId,'b');
    assert(!next.diary.includes('{{род:'));assert.equal(next.reviewed,false);
});

test('пары слов сохраняются при экспорте и импорте, старые библиотеки совместимы',()=>{
    const profile=genderProfile(),data={...C.emptyLibrary(),profiles:[profile]};
    assert.deepEqual(C.cleanLibrary(JSON.parse(JSON.stringify(data))),data);
    const old={id:'old',name:'Старый шаблон',variants:[{id:'old-v',title:'Вариант',diary:'Без вставок',examination:'',treatment:''}]};
    const migrated=C.cleanLibrary({...C.emptyLibrary(),version:1,profiles:[old]});
    assert.equal(migrated.version,3);
    assert.deepEqual(migrated.profiles[0].genderPairs,[]);
    assert.equal(C.renderVariant(migrated.profiles[0],old.variants[0],'').diary,'Без вставок');
});

test('неполная пара, неизвестная вставка и незаменённая вставка в рабочем тексте блокируются',()=>{
    const profile=genderProfile();
    const missing=structuredClone(profile);missing.genderPairs[0].female='';
    assert.throws(()=>C.cleanLibrary({...C.emptyLibrary(),profiles:[missing]}),/форму/);
    const unknown=structuredClone(profile);unknown.variants[0].diary='{{род:999}}';
    assert.throws(()=>C.cleanLibrary({...C.emptyLibrary(),profiles:[unknown]}),/нет пары/);
    const row={...C.createRow(),diary:'{{род:1}}',reviewed:true};
    assert(C.validateRow(row,{forSending:true}).some(error=>error.field==='diary'));
    const long=structuredClone(profile);long.variants[0].diary='x'.repeat(3992)+' больной';
    assert.throws(()=>C.renderVariant(long,long.variants[0],'male'),/4000/);
});

test('пример пользователя меняется в мужской форме и остаётся тем же в женской',()=>{
    const profile={genderPairs:[{id:'1',male:'больного',female:'больной'}]};
    const variant={diary:'На момент осмотра состояние больной тяжёлое.',examination:'',treatment:''};
    assert.equal(C.renderVariant(profile,variant,'male').diary,'На момент осмотра состояние больного тяжёлое.');
    assert.equal(C.renderVariant(profile,variant,'female').diary,variant.diary);
});

test('регистр, пунктуация и границы кириллических слов сохраняются',()=>{
    const profile={genderPairs:[{id:'1',male:'больного',female:'больной'}]};
    const variant={diary:'Больной, БОЛЬНОЙ; больной. Тяжелобольной больной1 больной_код.',examination:'',treatment:''};
    assert.equal(C.renderVariant(profile,variant,'male').diary,'Больного, БОЛЬНОГО; больного. Тяжелобольной больной1 больной_код.');
});

test('длинная фраза имеет приоритет, а пробелы между словами не мешают поиску',()=>{
    const profile={genderPairs:[{id:'1',male:'больной',female:'больная'},{id:'2',male:'состояние больного',female:'состояние больной'}]};
    const variant={diary:'Состояние  больной. Больной в палате.',examination:'',treatment:''};
    assert.equal(C.renderVariant(profile,variant,'male').diary,'Состояние больного. Больной в палате.');
    assert.equal(C.renderVariant(profile,variant,'female').diary,'Состояние  больной. Больная в палате.');
});

test('замены выполняются один раз, специальные символы в парах воспринимаются буквально',()=>{
    const profile={genderPairs:[{id:'1',male:'a+',female:'b(1)'},{id:'2',male:'b(1)',female:'c'}]};
    const variant={diary:'c; aa+; b11',examination:'',treatment:''};
    assert.equal(C.renderVariant(profile,variant,'male').diary,'b(1); aa+; b11');
});

test('неоднозначные пары не выбираются по порядку, а неизвестный род нужен только при совпадении',()=>{
    const profile={genderPairs:[{id:'1',male:'больного',female:'больной'},{id:'2',male:'больной',female:'больная'}]};
    const variant={diary:'Состояние больной.',examination:'',treatment:''};
    assert.throws(()=>C.renderVariant(profile,variant,'male'),/несколько разных замен/);
    assert.equal(C.renderVariant(profile,{...variant,diary:'Без изменений.'},'').diary,'Без изменений.');
});

test('старые обозначения преобразуются в обычные слова при чтении без изменения исходного файла',()=>{
    const data={...C.emptyLibrary(),version:2,profiles:[{id:'old',name:'Старый',genderPairs:[{id:'1',male:'больного',female:'больной'}],variants:[{id:'v',title:'Первый',diary:'Состояние {{род:1}}.',examination:'Осмотр {{род:1}}',treatment:''}]}]};
    const original=structuredClone(data),clean=C.cleanLibrary(data);
    assert.equal(clean.version,3);assert.equal(clean.profiles[0].variants[0].diary,'Состояние больного.');
    assert.equal(C.renderVariant(clean.profiles[0],clean.profiles[0].variants[0],'female').diary,'Состояние больной.');
    assert(!JSON.stringify(clean).includes('{{род:'));assert.deepEqual(data,original);
});

test('настройки сохраняют свободный текст и нулевой разброс, но ограничивают шаг и интервалы',()=>{
    assert.equal(C.cleanSettings().hourStep,4);
    const settings=C.cleanSettings({defaults:{pulse:'60 + ЭКС',pressure:'120/80 мм рт. ст.'},spread:{temperature:'0,1',pulse:0}});
    assert.equal(settings.defaults.pulse,'60 + ЭКС');assert.equal(settings.spread.temperature,.1);assert.equal(settings.spread.pulse,0);
    assert.throws(()=>C.cleanSettings({hourStep:1.5}),/целое/);
    assert.throws(()=>C.cleanSettings({spread:{systolic:21}}),/границы/);
    assert.throws(()=>C.cleanSettings({defaults:{temperature:'x'.repeat(68)}}),/67/);
});

test('автоподбор выключен по умолчанию, сохраняется явно и требует числовую основу',()=>{
    assert.equal(C.cleanSettings().autoPick,false);
    assert.equal(C.cleanSettings({autoPick:true}).autoPick,true);
    assert.equal(C.cleanSettings({autoPick:'false'}).autoPick,false);
    assert.throws(()=>C.cleanSettings({autoPick:true,defaults:{pulse:'60 + ЭКС'}}),/числовые/);
});

test('автоподбор первой записи использует исходные значения, следующих — предыдущие правки',()=>{
    const random=()=>.1;
    const first=C.createRow({autoPick:true,random});
    assert.notDeepEqual(first.vitals,C.DEFAULTS);
    first.vitals.pulse='120';
    const snapshot=C.clone(first);
    const next=C.createRow({previous:first,defaults:C.DEFAULTS,autoPick:true,random});
    assert(Number(next.vitals.pulse)>=110 && Number(next.vitals.pulse)<=130);
    assert.notEqual(next.vitals.pulse,'120');assert.deepEqual(first,snapshot);
    const inherited=C.createRow({previous:first,defaults:C.DEFAULTS,autoPick:false});
    assert.equal(inherited.vitals.pulse,'120');assert.notStrictEqual(inherited.vitals,first.vitals);
});

test('нулевой разброс не меняет значения; серия остаётся в границах каждого предыдущего значения',()=>{
    const zero=Object.fromEntries(Object.keys(C.DEFAULT_SPREAD).map(key=>[key,0]));
    assert.deepEqual(C.sampleVitals(C.DEFAULTS,zero),C.DEFAULTS);
    let seed=12345;
    const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
    let base={...C.DEFAULTS};
    for(let i=0;i<500;i++){
        const next=C.sampleVitals(base,C.DEFAULT_SPREAD,random);
        const oldBP=C.pressure(base.pressure),newBP=C.pressure(next.pressure);
        assert(Math.abs(C.number(next.temperature)-C.number(base.temperature))<=.300001);
        assert(Math.abs(Number(next.pulse)-Number(base.pulse))<=10);
        assert(Math.abs(Number(next.respiration)-Number(base.respiration))<=2);
        assert(Math.abs(newBP[0]-oldBP[0])<=20 && Math.abs(newBP[1]-oldBP[1])<=20);
        assert.deepEqual(C.validateVitals(next),[]);
        base=next;
    }
});
