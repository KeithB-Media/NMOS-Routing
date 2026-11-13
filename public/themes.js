// Apply before styles render so a saved light theme never flashes dark on reload.
(() => {
  if(['/embed','/embed/'].includes(location.pathname))document.documentElement.dataset.layout='embed';
  const key='nmos-route-theme',valid=new Set(['current','sapphire','graphite']);
  function apply(value) {
    const theme=valid.has(value)?value:'current';
    document.documentElement.dataset.theme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='sapphire'?'#0b1b3d':theme==='graphite'?'#171b1e':'#0d131b');
    document.querySelectorAll('[data-theme-picker]').forEach(picker=>picker.value=theme);
  }
  let initial='current';try {initial=localStorage.getItem(key);}catch {}
  apply(initial);
  document.addEventListener('change',event=>{
    if(!event.target.matches('[data-theme-picker]'))return;
    apply(event.target.value);
    try {localStorage.setItem(key,document.documentElement.dataset.theme);}catch {}
  });
  window.addEventListener('storage',event=>{if(event.key===key)apply(event.newValue);});
  document.addEventListener('DOMContentLoaded',()=>apply(document.documentElement.dataset.theme));
})();
