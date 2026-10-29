(function(scope){
    'use strict';
    function hemoglobinGL(value,unit){
        const text=String(value??'').trim().replace(',','.');
        if(!/^\d+(?:\.\d+)?$/.test(text))return NaN;
        const n=Number(text),u=String(unit||'').trim().toLowerCase().replace(/\s/g,'');
        if(n<=0)return NaN;
        if(/^(г\/л|g\/l)$/.test(u))return n;
        if(/^(г\/дл|g\/dl)$/.test(u))return n*10;
        return NaN;
    }
    function hemoglobinTone(value){
        if(!Number.isFinite(value)||value<=0)return '';
        if(value<75)return 'hb-low';
        if(value<=100)return 'hb-borderline';
        return '';
    }
    function glucoseMmolL(value,unit){
        const text=String(value??'').trim().replace(',','.');
        if(!/^\d+(?:\.\d+)?$/.test(text))return NaN;
        const n=Number(text),u=String(unit||'').trim().toLowerCase().replace(/\s/g,'');
        if(n<=0)return NaN;
        if(/^(ммоль\/л|mmol\/l)$/.test(u))return n;
        if(/^(мг\/дл|mg\/dl)$/.test(u))return n/18.0182;
        return NaN;
    }
    function glucoseTone(value){
        if(!Number.isFinite(value)||value<=0)return '';
        if(value<3.9)return 'glucose-low';
        if(value>=7)return 'glucose-high';
        if(value>=5.6)return 'glucose-borderline';
        return '';
    }
    const api={hemoglobinGL,hemoglobinTone,glucoseMmolL,glucoseTone};scope.FillBARSLabMarkers=api;
    if(typeof module!=='undefined')module.exports=api;
})(globalThis);
