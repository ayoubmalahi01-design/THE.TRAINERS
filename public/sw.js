const CACHE='the-trainers-shell-v6';
const ASSETS=['/','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/icon-maskable-512.png','/icons/apple-touch-icon.png','/icons/favicon-32.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('the-trainers-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
  return response;
 }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('/'))));
});
// Web Push: display notification when a push message arrives.
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch(e){data={title:'THE TRAINERS',body:event.data?event.data.text():''}};
  const title=data.title||'THE TRAINERS';
  const options={
    body:data.body||'',
    icon:data.icon||'/icons/icon-192.png',
    badge:'/icons/icon-192.png',
    tag:data.tag||'tt-notification',
    data:{url:data.url||'/'},
    requireInteraction:false,
  };
  event.waitUntil(self.registration.showNotification(title,options));
});
// Handle notification click: focus/open the relevant URL.
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data&&event.notification.data.url?event.notification.data.url:'/';
  event.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(windowClients=>{
      for(const client of windowClients){
        if(client.url.includes(self.location.origin)&&'focus' in client){
          client.navigate(url);
          return client.focus();
        }
      }
      if(clients.openWindow)return clients.openWindow(url);
    })
  );
});
// Handle push subscription change.
self.addEventListener('pushsubscriptionchange',event=>{
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options).then(subscription=>{
      // Notify the app about the new subscription via postMessage.
      return self.clients.matchAll().then(clients=>{
        clients.forEach(client=>client.postMessage({type:'push-subscription-changed',subscription:subscription.toJSON()}));
      });
    }).catch(err=>console.error('pushsubscriptionchange failed',err))
  );
});
