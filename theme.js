(function(){
  var R=document.documentElement,K='ent-theme',mq=window.matchMedia('(prefers-color-scheme: dark)');
  function saved(){try{var v=localStorage.getItem(K);if(v==='day'||v==='night')return v}catch(e){}return null}
  function pick(){return saved()||(mq.matches?'night':'day')}
  function set(t,save){
    R.setAttribute('data-theme',t);
    var m=document.querySelector('meta[name="theme-color"]');
    if(m)m.setAttribute('content',t==='night'?'#0B0F19':'#F6F7FB');
    var b=document.getElementById('theme');
    if(b)b.textContent=t==='night'?'Дневная тема':'Ночная тема';
    if(save){try{localStorage.setItem(K,t)}catch(e){}}
  }
  set(pick(),false);
  document.addEventListener('DOMContentLoaded',function(){
    set(R.getAttribute('data-theme'),false);
    var b=document.getElementById('theme');
    if(b)b.addEventListener('click',function(){set(R.getAttribute('data-theme')==='night'?'day':'night',true)});
  });
  if(mq.addEventListener)mq.addEventListener('change',function(){if(!saved())set(pick(),false)});
})();
