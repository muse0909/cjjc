// sw.js - Service Worker 脚本
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// 监听来自主页面的推送指令
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const title = event.data.title;
        const options = {
            body: event.data.body,
            icon: event.data.icon || 'https://jrsy081113-hue.github.io/jrsy/star-icon.png',
            badge: event.data.icon || 'https://jrsy081113-hue.github.io/jrsy/star-icon.png', // 安卓状态栏小图标
            vibrate: [200, 100, 200], // 震动模式
            tag: 'ai_msg', // 相同标签的消息会覆盖，防止刷屏
            renotify: true,
            data: {
                url: self.location.origin // 记录点击后跳转的地址
            }
        };
        self.registration.showNotification(title, options);
    }
});

// 监听通知点击事件
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                if (client.url === event.notification.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url);
            }
        })
    );
});