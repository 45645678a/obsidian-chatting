'use strict';
function createBookLibrary(){
  const clean=path=>String(path??'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
  const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
  function locate(record){
    if(!record||record.kind==='free')return{book:'free:',chapter:'',scope:'free:'};
    const path=clean(record.path),parts=path.split('/');
    const chapter=record.kind==='note'?parts.slice(0,-1).join('/'):path;
    const book=chapter?chapter.split('/')[0]:'';
    return{book:'book:'+book,chapter:'chapter:'+chapter,scope:record.kind+':'+path};
  }
  function index(paths,store){
    const actual=new Set(paths.map(clean)),books=new Map();
    function add(path,type='note'){
      path=clean(path);const parts=path.split('/');
      const parent=type==='note'?parts.slice(0,-1).join('/'):path;
      const bookPath=parent?parent.split('/')[0]:'';
      const bookKey='book:'+bookPath,chapterKey='chapter:'+parent;
      if(!books.has(bookKey))books.set(bookKey,{key:bookKey,path:bookPath,title:bookPath||'未分书的笔记',chapters:new Map()});
      const book=books.get(bookKey);
      if(!book.chapters.has(chapterKey))book.chapters.set(chapterKey,{key:chapterKey,path:parent,title:parent===bookPath?'未分章':parent.slice(bookPath.length+1),sections:new Map()});
      if(type==='note')book.chapters.get(chapterKey).sections.set('note:'+path,{key:'note:'+path,path,title:parts.at(-1).replace(/\.md$/i,''),exists:actual.has(path)});
    }
    for(const path of actual){
      const folders=path.split('/').slice(0,-1);
      if(folders.some(part=>part.startsWith('.')||['raw','assets','attachments','images','附件'].includes(part.toLowerCase())))continue;
      add(path);
    }
    for(const record of store?.conversations??[]){
      if(record.kind!=='free'&&(record.chatHistory.length||record.id===store.activeId||record.archived))add(record.path,record.kind);
    }
    return [...books.values()].map(book=>({...book,chapters:[...book.chapters.values()].map(chapter=>({...chapter,
      sections:[...chapter.sections.values()].sort((a,b)=>collator.compare(a.title,b.title))})).sort((a,b)=>collator.compare(a.title,b.title))}))
      .sort((a,b)=>collator.compare(a.title,b.title));
  }
  function descriptor(scope){
    if(scope==='free:')return{kind:'free',path:'',lastNotePath:null};
    if(scope.startsWith('note:'))return{kind:'note',path:scope.slice(5),lastNotePath:scope.slice(5)};
    if(scope.startsWith('chapter:'))return{kind:'chapter',path:scope.slice(8),lastNotePath:null};
    return null;
  }
  function matches(record,selection){
    const place=locate(record);
    return(!selection.book||selection.book===place.book)&&(!selection.chapter||selection.chapter===place.chapter)&&(!selection.scope||selection.scope===place.scope);
  }
  function rectangle(rect,viewport,zoom=1){
    const left=Math.max(0,rect.x),top=Math.max(0,rect.y),right=Math.min(viewport.width,rect.x+rect.width),bottom=Math.min(viewport.height,rect.y+rect.height);
    if(right-left<30||bottom-top<30)throw new Error('当前阅读区域不可见，请先打开要截取的页面。');
    return{x:Math.floor(left*zoom),y:Math.floor(top*zoom),width:Math.ceil((right-left)*zoom),height:Math.ceil((bottom-top)*zoom)};
  }
  return{index,locate,descriptor,matches,rectangle};
}
module.exports={createBookLibrary};
