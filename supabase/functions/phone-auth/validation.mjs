export function normalizePhone(value) {
 const raw=String(value||'').trim();if(!/^[+\d\s()-]+$/.test(raw))throw Error('Enter a valid phone number.');
 let digits=raw.replace(/\D/g,'');
 if(digits.length===10&&!raw.startsWith('+'))digits='91'+digits;
 if(!/^[1-9]\d{7,14}$/.test(digits))throw Error('Enter a valid phone number with country code.');
 return '+'+digits;
}
export function validatePin(value) {
 if(typeof value!=='string'||!/^\d{4}$/.test(value))throw Error('Choose a PIN with exactly four digits.');
 return value;
}
const weakPins=new Set(['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','2345','3456','4567','5678','6789','0123','1212','2580','1122','1004']);
// Applies only when choosing a PIN, never at sign-in, so existing users are not locked out.
export function validateNewPin(value) {
 validatePin(value);
 if(weakPins.has(value))throw Error('That PIN is too easy to guess. Choose a different four digits.');
 return value;
}
export function makeActivationCode() {
 return Array.from(crypto.getRandomValues(new Uint8Array(18)),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function hashActivationCode(value) {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function hashPin(pin,salt=makeActivationCode()) {
 validatePin(pin);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:210000,hash:'SHA-256'},key,256);
 return {salt,hash:Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join('')};
}
export async function verifyPin(pin,stored) {
 if(!stored?.hash||!stored?.salt||typeof pin!=='string'||!/^\d{4}$/.test(pin))return false;
 const next=await hashPin(pin,stored.salt);let difference=next.hash.length^stored.hash.length;
 for(let i=0;i<next.hash.length;i++)difference|=next.hash.charCodeAt(i)^(stored.hash.charCodeAt(i)||0);
 return difference===0;
}
