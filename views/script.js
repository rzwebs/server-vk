const socket = io();

    // Подписываемся на событие обновления диалога
    socket.on('dialogUpdated', (messages) => {
    console.log('Диалог обновлен:', messages);
    // Здесь выполните логику обновления интерфейса с использованием полученных сообщений
    });