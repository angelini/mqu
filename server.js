var tako = require('tako')
  , path = require('path')
  , redis = require('redis')
  , async = require('async')
  , uuid = require('node-uuid')
  , config = require('./config')
  , Events = require('events')

  , events = new Events.EventEmitter()
  , db = redis.createClient(config.REDIS_PORT, config.REDIS_HOST)
  , app = tako({ socketio: { 'log level': 1 } })
  ;

if (process.env.NODE_ENV != 'dev') {
  db.auth(config.REDIS_PASS);
}

var sendErr = function(err, res, code) {
  res.statusCode = code || 500;
  console.log('Err ' + res.statusCode + ':', err);
  res.end();
};

var cat = function() {
  var i = 0
    , args = Array.prototype.slice.call(arguments)
    , response = ''
    ;

  for (i = 0; i < args.length; i++) {
    response += args[i] + (i === (args.length - 1) ? '': config.SPLIT);
  }

  return response;
};

app.route('/static/*').files(path.join(__dirname, 'static'));

app.route('/').file('./index.html');

app.route('/api/rooms')
  .json(function (req, res) {
    if (req.method == 'GET') {
      db.smembers(config.ROOMS, function(err, rooms) {
        if (err) { return sendErr(err, res); }
        res.end(rooms);
      });
    }

    if (req.method == 'POST') {
      req.on('json', function(obj) {
        if (!obj || !obj.name) { return sendErr(new Error('Fields Missing'), res); }

        db.sismember(config.ROOMS, obj.name, function(err, is) {
          if (err) { return sendErr(err, res); }
          if (is) { return sendErr(new Error('Name already in use'), res); }

          async.parallel([
              function(cb) { db.hmset(cat(config.ROOMS, obj.name), obj, cb); }
            , function(cb) { db.sadd(config.ROOMS, obj.name, cb); }
          ], function(err) {
            if (err) { return sendErr(err, res); }
            res.end();
          });
        });
      });
    }
  })
  .methods('GET', 'POST')
  ;

app.route('/api/rooms/:name')
  .json(function (req, res) {
    db.hgetall(cat(config.ROOMS, req.params.name), function(err, room) {
      if (err) { return sendErr(err, res); }
      if (!room) { return sendErr(err, res, 404); }
      res.end(room);
    });
  })
  .methods('GET')
  ;

app.route('/api/rooms/:name/queue')
  .json(function(req, res) {
    if (req.method == 'GET') {
      var roomlock = false;
      async.waterfall([
          function(cb) { db.get(cat(config.ROOMS, req.params.name, config.LOCK), cb); }
        , function(lock, cb) {
            if (lock) { roomlock = true; }
            db.lrange(cat(config.QUEUE, req.params.name), 0, -1, cb); 
          }
        , function(ids, cb) {
            async.map(ids, function(id, cb) { db.hgetall(cat(config.SONG, id), cb); }, cb);
          }
      ], function(err, songs) {
        if (err) { return sendErr(err, res); }
        res.end({songs: songs, lock: roomlock});
      });
    }

    if (req.method == 'POST') {
      req.on('json', function(song) {
        if (!song) { return sendErr(new Error('Empty Body'), res); }

        song.room = req.params.name;
        song.id = uuid.v4();

        async.parallel([
            function(cb) { db.rpush(cat(config.QUEUE, song.room), song.id, cb); }
          , function(cb) { db.hmset(cat(config.SONG, song.id), song, cb); }
        ], function(err) {
          if (err) { return sendErr(err, res); }
          events.emit('add', song);
          res.end();
        });
      });
    }

    if (req.method == 'DELETE') {
      db.lpop(cat(config.QUEUE, req.params.name), function(err, id) {
        if (err) { return sendErr(err, res); }
        events.emit('remove', id);
        res.end();
      });
    }
  })
  .methods('GET', 'POST', 'DELETE')
  ;

app.sockets.on('connection', function(socket) {
  var add = function(song) {
        app.sockets.emit('add', song);
      }
    , remove = function(id) {
        app.sockets.emit('remove', id);
      }
    , release = function() {
        socket.get('master', function(err, room) {
          if (room) {
            app.sockets.emit('release', { room: room });
            db.del(cat(config.ROOMS, room, config.LOCK), function() {});
          }
        });
      }
    ;

  events.on('add', add);
  events.on('remove', remove);

  socket.on('master', function(room) {
    db.getset(cat(config.ROOMS, room, config.LOCK), 1, function(err, locked) {
      if (!locked) {
        app.sockets.emit('master', { room: room });
        socket.set('master', room, function() {});
      }
    });
  });

  socket.on('release', release);

  socket.on('disconnect', function() {
    events.removeListener('add', add);
    events.removeListener('remove', remove);
    release();
  });
});

app.httpServer.listen(config.PORT);
