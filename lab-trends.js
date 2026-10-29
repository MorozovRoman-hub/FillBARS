(function(scope){
    'use strict';
    const definitions={
        hemoglobin:{label:'Гемоглобин',unit:'г/л',digits:1},
        creatinine:{label:'Креатинин',unit:'мкмоль/л',digits:1},
        glucose:{label:'Глюкоза',unit:'ммоль/л',digits:2}
    };
    function dateStamp(value){
        const text=String(value||'').trim();
        let match=text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        let year,month,day,hour,minute,second;
        if(match)[,day,month,year,hour='0',minute='0',second='0']=match;
        else{
            match=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
            if(!match)return null;
            [,year,month,day,hour='0',minute='0',second='0']=match;
        }
        const stamp=Date.UTC(+year,+month-1,+day,+hour,+minute,+second),date=new Date(stamp);
        return date.getUTCFullYear()===+year&&date.getUTCMonth()===+month-1&&date.getUTCDate()===+day&&+hour<24&&+minute<60&&+second<60?stamp:null;
    }
    function series(key,rows){
        const lab=scope.FillBARSLabMarkers||(typeof require==='function'?require('./lab-markers'):null);
        const kidney=scope.FillBARSKidney||(typeof require==='function'?require('./kidney-function'):null);
        return (rows||[]).map(row=>{
            let value=NaN;
            if(key==='hemoglobin')value=lab.hemoglobinGL(row.value,row.unit);
            if(key==='glucose')value=lab.glucoseMmolL(row.value,row.unit);
            if(key==='creatinine')value=kidney.creatinineMgDl(row.value,row.unit)*88.4;
            return {...row,value,stamp:dateStamp(row.date)};
        }).filter(row=>Number.isFinite(row.value)&&row.value>0)
            .sort((a,b)=>(a.stamp===null?Infinity:a.stamp)-(b.stamp===null?Infinity:b.stamp));
    }
    const format=(value,digits)=>Number(value.toFixed(digits)).toLocaleString('ru-RU',{maximumFractionDigits:digits});
    function render(host,history,rowCount){
        if(!host)return;
        const doc=host.ownerDocument;
        host.replaceChildren();
        const node=(tag,text,parent=host)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;parent.append(el);return el;};
        node('p',history?`По загруженным направлениям БАРС: ${rowCount||0}. До 12 последних датированных результатов каждого анализа. Это может быть часть истории.`:'Обновите данные из БАРС, чтобы увидеть динамику.').className='trend-note';
        if(!history)return;
        for(const [key,definition] of Object.entries(definitions)){
            const section=node('section');section.className='trend-section';
            node('h4',definition.label+' · '+definition.unit,section);
            const all=series(key,history[key]),dated=all.filter(row=>row.stamp!==null).slice(-12),unknown=all.filter(row=>row.stamp===null);
            if(!all.length){node('p','Результаты с распознанными единицами не найдены.',section).className='trend-note';continue;}
            if(dated.length>=2){
                const min=Math.min(...dated.map(row=>row.value)),max=Math.max(...dated.map(row=>row.value));
                const start=dated[0].stamp,span=dated.at(-1).stamp-start;
                const x=row=>24+(span?(row.stamp-start)/span:0.5)*272;
                const y=row=>72-(max===min?0.5:(row.value-min)/(max-min))*52;
                const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
                svg.setAttribute('viewBox','0 0 320 100');svg.setAttribute('role','img');
                svg.setAttribute('aria-label',definition.label+': '+dated.map(row=>row.date+' — '+format(row.value,definition.digits)+' '+definition.unit).join('; '));
                section.append(svg);
                const shape=(tag,attrs)=>{const el=doc.createElementNS(svg.namespaceURI,tag);for(const [name,value] of Object.entries(attrs))el.setAttribute(name,value);svg.append(el);return el;};
                shape('line',{x1:24,y1:78,x2:296,y2:78,stroke:'#cbd5df'});
                shape('polyline',{points:dated.map(row=>x(row)+','+y(row)).join(' '),fill:'none',stroke:'#267c51','stroke-width':2});
                for(const row of dated){const dot=shape('circle',{cx:x(row),cy:y(row),r:3,fill:'#267c51'});const title=doc.createElementNS(svg.namespaceURI,'title');title.textContent=row.date+': '+format(row.value,definition.digits)+' '+definition.unit;dot.append(title);}
                for(const [label,position,anchor] of [[dated[0].date,24,'start'],[dated.at(-1).date,296,'end']])shape('text',{x:position,y:95,'text-anchor':anchor,'font-size':10,fill:'#52606d'}).textContent=label;
                node('p',`Диапазон: ${format(min,definition.digits)}–${format(max,definition.digits)} ${definition.unit}. Шкала по времени; у каждого графика свой масштаб.`,section).className='trend-note';
            }else node('p',dated.length?'Для графика нужен ещё один датированный результат.':'Нет результатов с достоверной датой для графика.',section).className='trend-note';
            const table=node('table',undefined,section);table.className='trend-table';
            const head=node('tr',undefined,node('thead',undefined,table));
            for(const label of ['Дата','Значение','Источник'])node('th',label,head).scope='col';
            const body=node('tbody',undefined,table);
            for(const row of [...dated].reverse().concat(unknown.slice(0,12))){
                const tr=node('tr',undefined,body);
                node('td',row.stamp===null?(row.date||'Дата неизвестна')+' (не на графике)':row.date,tr);
                node('td',format(row.value,definition.digits),tr);
                node('td',row.service||'Лаборатория',tr);
            }
            if(unknown.length)node('p',`Без достоверной даты: ${unknown.length}; показано до 12 таких записей отдельно.`,section).className='trend-note';
        }
    }
    const api={dateStamp,series,render};scope.FillBARSLabTrends=api;
    if(typeof module!=='undefined')module.exports=api;
})(globalThis);
