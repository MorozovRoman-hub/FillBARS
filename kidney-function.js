/* Adult kidney estimates. These are decision aids, not a CKD diagnosis. */
(function(scope){
    'use strict';
    const number=value=>{
        const text=String(value??'').trim().replace(',','.');
        return /^\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;
    };
    function ageAt(birthDate,at=new Date()){
        const match=String(birthDate||'').match(/^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[./-](\d{1,2})[./-](\d{4}))$/);
        if(!match)return NaN;
        const year=+(match[1]||match[6]),month=+(match[2]||match[5]),day=+(match[3]||match[4]);
        const birth=new Date(year,month-1,day);
        if(birth.getFullYear()!==year||birth.getMonth()!==month-1||birth.getDate()!==day)return NaN;
        return at.getFullYear()-year-(at.getMonth()+1<month||(at.getMonth()+1===month&&at.getDate()<day)?1:0);
    }
    function normalizeSex(value){
        const text=String(value??'').trim().toLocaleLowerCase('ru-RU');
        if(/^(м|муж|мужской|male|1)$/.test(text))return 'male';
        if(/^(ж|жен|женский|female|0)$/.test(text))return 'female';
        return '';
    }
    function creatinineMgDl(value,unit){
        const n=number(value),u=String(unit||'').trim().toLowerCase().replace(/\s/g,'');
        if(!Number.isFinite(n)||n<=0)return NaN;
        if(/^(ммоль\/л|mmol\/l)$/.test(u))return n*1000/88.4;
        if(/^(мкмоль\/л|мкмольл|µmol\/l|μmol\/l|umol\/l)$/.test(u))return n/88.4;
        if(/^(мг\/дл|mg\/dl)$/.test(u))return n;
        return NaN;
    }
    function category(value){
        if(!Number.isFinite(value)||value<=0)return null;
        if(value>=90)return {code:'G1',description:'нормальная или высокая',tone:'g1'};
        if(value>=60)return {code:'G2',description:'незначительно снижена',tone:'g2'};
        if(value>=45)return {code:'G3a',description:'умеренно снижена',tone:'g3a'};
        if(value>=30)return {code:'G3b',description:'существенно снижена',tone:'g3b'};
        if(value>=15)return {code:'G4',description:'резко снижена',tone:'g4'};
        return {code:'G5',description:'крайне низкая',tone:'g5'};
    }
    function calculate({sex,age,weight,creatinine,unit}){
        const normalizedSex=normalizeSex(sex),a=number(age),w=number(weight),scr=creatinineMgDl(creatinine,unit);
        const errors=[];
        if(!normalizedSex)errors.push('пол');
        if(!Number.isInteger(a)||a<18||a>120)errors.push('возраст 18–120 лет');
        if(!Number.isFinite(scr)||scr<0.1||scr>30)errors.push('креатинин с единицей измерения');
        let egfr=null,crcl=null;
        if(!errors.length){
            const female=normalizedSex==='female',k=female?0.7:0.9,alpha=female?-0.241:-0.302,ratio=scr/k;
            egfr=142*Math.pow(Math.min(ratio,1),alpha)*Math.pow(Math.max(ratio,1),-1.2)*Math.pow(0.9938,a)*(female?1.012:1);
            if(Number.isFinite(w)&&w>=2&&w<=400&&a<140)crcl=((140-a)*w)/(72*scr)*(female?0.85:1);
        }
        return {egfr,crcl,category:category(egfr),errors,weightMissing:crcl===null,creatinineMgDl:scr};
    }
    const api={ageAt,normalizeSex,creatinineMgDl,category,calculate};
    scope.FillBARSKidney=api;
    if(typeof module!=='undefined')module.exports=api;
})(globalThis);
