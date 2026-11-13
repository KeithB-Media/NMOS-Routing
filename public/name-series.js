// Parse the seed once so alphabetic carry keeps its original prefix.
export function nameSeries(seed,count) {
  if(typeof seed!=='string'||!seed.trim()||!Number.isInteger(count)||count<1||count>501)throw new Error('Select a starting name and up to 500 following rows.');
  seed=seed.trim();
  const numeric=seed.match(/^(.*?)(\d+)$/);
  let prefix,suffix,start,format;
  if(numeric){
    [,prefix,suffix]=numeric;start=BigInt(suffix);
    format=value=>prefix+value.toString().padStart(suffix.length,'0');
  }else{
    const letters=seed.match(/^(.*[\s_\-])([a-zA-Z]+)$/)||seed.match(/^(.*?)([A-Z]+)$/)||seed.match(/^(.*)([a-zA-Z])$/);
    if(!letters)throw new Error('The starting name must end in a number or letter.');
    [,prefix,suffix]=letters;
    if(suffix!==suffix.toUpperCase()&&suffix!==suffix.toLowerCase())throw new Error('Use an all-uppercase or all-lowercase letter suffix.');
    start=[...suffix.toUpperCase()].reduce((value,c)=>value*26n+BigInt(c.charCodeAt(0)-64),0n);
    format=value=>{
      let text='';while(value>0n){value--;text=String.fromCharCode(65+Number(value%26n))+text;value/=26n;}
      return prefix+(suffix===suffix.toLowerCase()?text.toLowerCase():text);
    };
  }
  const result=Array.from({length:count},(_,i)=>format(start+BigInt(i)));
  if(result.some(name=>name.length>200))throw new Error('A filled name would exceed 200 characters.');
  return result;
}
