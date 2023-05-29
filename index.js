const express = require('express');
const path = require('path');
const { VK, getRandomId } = require('vk-io');
const cors = require('cors');
const axios = require('axios')

const session = require('express-session');
const passport = require('passport');
const VKontakteStrategy = require('passport-vkontakte').Strategy;
const config = require('./config');

const socketServer = require('socket.io')(4001, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


app.use(cors({
  credentials: true,
  origin: '*'
}));

app.use(session({
  secret: 'YOUR_SESSION_SECRET', // Секретный ключ сессии
  resave: false,
  saveUninitialized: false
}));

const vk = new VK({
    token: 'vk1.a.U73vde2RQsYbf1jrYoGiYjDPTTAR7K2vA3DjqGd8l1bsxk_SClbTnTt7G8XkEVnrngXHzGj-xo3vRe5yXcuhGV_kgIHYFNx4XwS2YNm_j8_E1AiTDfwcHc8o76Ef_58osgg6N8p4jIxJ7ookuZH_aXklTlQvT7rFg4PIpK3Kvo1oNfysdPsY1dxwzH-5hMP7q0H2E08SLxUBM5zwSvJnEg',
    apiMode: 'parallel',
});


app.use(passport.initialize());
app.use(passport.session());


// Список айдишников диалогов, которые нужно отображать
const dialogIds = ['393838764', '424616130', '242007638'];

app.use('/views', express.static(path.join(__dirname, 'views')));


// Конфигурация Passport.js для авторизации через ВКонтакте
passport.use(new VKontakteStrategy(config.vkontakteAuth,
  (accessToken, refreshToken, params, profile, done) => {
    profile.accessToken = accessToken;
    profile.refreshToken = refreshToken; // Сохраняем refreshToken в профиле пользователя
    return done(null, profile);
  }
));

const refreshAccessToken = (refreshToken, done) => {
  // Ваша логика для обновления токена доступа
  // Здесь вам потребуется выполнить запрос к API ВКонтакте, используя refreshToken,
  // чтобы получить новый accessToken и обновить его в профиле пользователя

  // Пример запроса к API ВКонтакте для обновления токена доступа
  // Здесь предполагается, что вы используете axios для выполнения HTTP-запросов

  axios.get('https://oauth.vk.com/access_token', {
    params: {
      grant_type: 'refresh_token',
      client_id: config.vkontakteAuth.clientID,
      client_secret: config.vkontakteAuth.clientSecret,
      refresh_token: refreshToken
    }
  })
    .then(response => {
      const newAccessToken = response.data.access_token;

      // Обновляем accessToken в профиле пользователя
      profile.accessToken = newAccessToken;
      done(null, profile);
    })
    .catch(error => {
      done(error, null);
    });
};

// Сериализация и десериализация пользователя
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Маршрут для начала авторизации через ВКонтакте
app.get('/auth/vkontakte', passport.authenticate('vkontakte'));

app.get('/auth/vkontakte/callback',
  passport.authenticate('vkontakte', { failureRedirect: '/login' }),
  (req, res) => {
    const accessToken = req.user.accessToken;
    const refreshToken = req.user.refreshToken;
    const profile = req.user;

    console.log(accessToken, refreshToken, profile)

    // Проверяем срок действия токена доступа
    // В данном примере считаем, что токен действителен 1 час (3600 секунд)
    const expirationTime = 3600;
    const currentTime = Math.floor(Date.now() / 1000); // Текущее время в секундах

    if (req.isAuthenticated() && currentTime < (profile.auth_time + expirationTime)) {
      // Токен доступа действителен, продолжаем обработку
      res.redirect('/profile');
    } else {
      // Токен доступа истек, обновляем его
      refreshAccessToken(refreshToken, (error, updatedProfile) => {
        if (error) {
          // Обработка ошибки обновления токена доступа
          //res.redirect('/login');
          res.send('Ошибка авторизации');
        } else {
          // Токен доступа обновлен, продолжаем обработку
          req.user = updatedProfile;
          res.redirect('/profile');
        }
      });
    }
  }
);

// Маршрут для выхода пользователя
app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

// Защищенный маршрут, доступный только авторизованным пользователям
app.get('/profile', (req, res) => {
  // req.user содержит данные авторизованного пользователя
  res.send('Профиль пользователя: ' + JSON.stringify(req.user));
});

// Главная страница - список диалогов
app.get('/', async (req, res) => {
    try {
      const dialogs = await Promise.all(dialogIds.map(async (id) => {
        const user = await vk.api.users.get({
          user_id: id,
          fields: 'photo_100'
        });
  
        return {
          id,
          name: `${user[0].first_name} ${user[0].last_name}`,
          avatar: `${user[0].photo_100}`
        };
      }));
  
      res.json({ dialogs });
    } catch (error) {
      console.error('Error retrieving dialogs:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
    
  });

// Страница диалога
app.get('/dialog/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const user = await vk.api.users.get({
            user_id: userId,
        });

        const dialog = await vk.api.messages.getHistory({
            user_id: userId,
            count: 20,
        });

        const messages = dialog.items.reverse();

        res.json({ user: user[0], messages });
    } catch (error) {
        console.error('Error retrieving dialog:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Обработчик отправки сообщения
app.post('/dialog/:userId/send', async (req, res) => {
    const { userId } = req.params;
    const { message } = req.body;

    try {
        await vk.api.messages.send({
            user_id: userId,
            random_id: getRandomId(),
            message,
        });

        res.redirect(`/dialog/${userId}`);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).send('Internal Server Error');
    }
});

  // Обработчик события message_new
  vk.updates.on('message_new', async (context, next) => {
    const { text, peerId, senderId, attachments } = context.message;
    // Проверяем, совпадает ли отправитель с нужным идентификатором
    dialogIds.forEach((elem) => {
      if (context.senderId == elem) {

        console.log('Новое сообщение:', text, 'Идентификатор отправителя:', context.senderId);
        console.log(socketServer.emit('newMessage', { text, senderId, attachments, peerId }))
      }
    });
    next();
  });


vk.updates.start().catch(console.error);

// Запуск сервера
app.listen(4000, () => {
    console.log('Server running on port 4000');
});