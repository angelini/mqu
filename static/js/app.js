/*global _ Backbone jQuery Mustache io swfobject */

var app = {
    $main: (function() { return $('#main'); }())

  , module: (function() {
      var modules = {};

      return function(name) {
        if (modules[name]) { return modules[name]; }
        modules[name] = {};
        return modules[name];
      };
    }())

  , socket: (function() {
      var url = window.location.protocol + '//' + window.location.host;
      return io.connect();
    }())

  , api: function(url, method, data, cb) {
      var req = $.ajax({
          url: '/api/' + url
        , type: method
        , data: JSON.stringify(data)
        , contentType: 'application/json'
      });

      req.done(cb);
      req.fail(function() {
        console.log('API Request failed:', arguments);
      });
    }

  , maxLength: function(string, length) {
      if (string.length <= length) { return string; }
      return string.substr(0, length - 3) + '...';
    }

  , join: function(name) {
      var Search = app.module('search')
        , searchCollection = new Search.Collection()
        , searchView = new Search.CollectionView({
            collection: searchCollection
          })

        , Player = app.module('player')
        , playerCollection = new Player.Collection()
        , playerView = new Player.CollectionView({
            collection: playerCollection
          })
        ;

      app.room = name;

      playerCollection.on('reset', function() {
        app.$main.empty()
                 .append(playerView.render().el)
                 .append(searchView.render().el);
      });

      playerCollection.fetch();
    }

  , create: function(name) {
      app.api('rooms', 'POST', {name: name}, function() {
        app.join(name);
      });
    }

  , init: function() {
      var Menu = app.module('menu')
        , menuCollection = new Menu.Collection()
        , menuView = new Menu.CollectionView({
            collection: menuCollection
          })
        ;

      menuCollection.on('reset', function() {
        app.$main.html(menuView.render().el);
      });

      menuCollection.fetch();
    }
};

(function(Player) {

  Player.Model = Backbone.Model.extend({
    play: function() {
      var that = this
        , url = this.get('url') + '?enablejsapi=1&playerapiid=ytplayer&version=3'
        , params = { allowScriptAccess: 'always' }
        , atts = { id: 'player' }
        ;

      $('#player').replaceWith('<div id="player-cont"></div>');

      window.playerStateChange = function(state) {
        if (state === 0) { that.trigger('finished'); }
      };

      window.onYouTubePlayerReady = function() {
        var player = $('#player')[0];
        player.addEventListener('onStateChange', 'playerStateChange');
        if (player) { player.playVideo(); }
      };

      swfobject.embedSWF(url, 'player-cont', '640', '390', '8', null, null, params, atts);
    }
  });

  Player.View = Backbone.View.extend({
      tagName: 'li'

    , render: function() {
        var html = Mustache.to_html(this.template, this.model.attributes);
        this.$el.html(html);
        return this;
      }

    , initialize: function() {
        _.bindAll(this);
        this.template = $('#song-tmpl').html();
      }
  });

  Player.Collection = Backbone.Collection.extend({
      playing: false

    , locked: false

    , fetch: function() {
        var that = this
          , url = 'rooms/' + app.room + '/queue'
          ;

        app.api(url, 'GET', null, function(info) {
          that.locked = info.lock;

          var models = _.map(info.songs, function(song) {
            return new Player.Model(song);
          });

          that.reset(models);
        });
      }

    , play: function() {
        var that = this
          , song = this.shift()
          , url = 'rooms/' + app.room + '/queue'
          ;

        this.playing = true;

        if (!song) {
          this.playing = false;
          this.locked = false;
          app.socket.emit('release');
          this.emit('finished');
          return;
        }

        song.on('finished', this.play);

        app.api(url, 'DELETE', null, function() {});
        app.socket.emit('master', app.room);

        song.play();
      }

    , initialize: function() {
        var that = this;
        _.bindAll(this);

        app.socket.on('add', function(song) {
          if (song.room == app.room) {
            that.add(new Player.Model(song));
          }
        });

        app.socket.on('remove', function(id) {
          var model = that.get(id);
          that.remove(model);
        });

        app.socket.on('master', function(master) {
          if (!that.playing && app.room == master.room) {
            this.locked = true;
            that.trigger('locked');
          }
        });

        app.socket.on('release', function(master) {
          console.log('release ran', master);
          if (app.room == master.room) {
            that.locked = false;
            that.trigger('released');
          }
        });
      }
  });

  Player.CollectionView = Backbone.View.extend({
      className: 'player-area span12'

    , events: {
        'click .play': 'play'
      }

    , play: function(ev) {
        ev.preventDefault();
        this.collection.play();
      }

    , renderPlayerCont: function() {
        if (this.collection.locked) {
          this.$el.find('#player-cont').html(this.lockedTmpl);
        } else {
          this.$el.find('#player-cont').html(this.playerCont);
        }
      }

    , renderList: function() {
        var $list = this.$el.find('ol');
        $list.empty();

        this.collection.each(function(model) {
          var view = new Player.View({model: model});
          $list.append(view.render().el);
        });

        if (this.collection.length === 0) {
          $list.append('<div>Queue currently empty</div>');
        }
      }

    , render: function() {
        this.$el.html(this.template);
        this.renderPlayerCont();
        this.renderList();
        return this;
      }

    , initialize: function() {
        _.bindAll(this);
        this.template = $('#queue-tmpl').html();
        this.playerCont = $('#player-cont-tmpl').html();
        this.lockedTmpl = $('#locked-tmpl').html();

        this.collection.on('finished', this.renderPlayerCount);
        this.collection.on('released', this.renderPlayerCount);

        this.collection.on('add', this.renderList);
        this.collection.on('remove', this.renderList);
        this.collection.on('locked', this.renderPlayerCount);
      }
  });

}(app.module('player')));

(function(Menu) {

  Menu.Model = Backbone.Model.extend({
    join: function() {
      app.router.navigate('rooms/' + this.get('name'), {trigger: true});
    }
  });

  Menu.View = Backbone.View.extend({
      tagName: 'li'

    , events: {
        'click a': 'join'
      }

    , join: function(ev) {
        ev.preventDefault();
        this.model.join();
      }

    , render: function() {
        var html = Mustache.to_html(this.template, this.model.attributes);
        this.$el.html(html);
        return this;
      }

    , initialize: function() {
        _.bindAll(this);
        this.template = $('#room-tmpl').html();
      }
  });

  Menu.Collection = Backbone.Collection.extend({
      create: function(name) {
        app.create(name);
      }

    , fetch: function() {
        var that = this;

        app.api('rooms', 'GET', null, function(rooms) {
          var models = _.map(rooms, function(room) {
            return new Menu.Model({name: room});
          });

          that.reset(models);
        });
      }
  });

  Menu.CollectionView = Backbone.View.extend({
      className: 'menu span12'

    , events: {
        'submit .create': 'create'
      }

    , create: function(ev) {
        ev.preventDefault();
        var name = this.$el.find('input').val();
        if (name) { this.collection.create(name); }
      }

    , render: function() {
        this.$el.html(this.template);
        var $list = this.$el.find('ul');

        this.collection.each(function(model) {
          var view = new Menu.View({ model: model });
          $list.append(view.render().el);
        });

        return this;
      }

    , initialize: function() {
        _.bindAll(this);
        this.template = $('#menu-tmpl').html();
      }
  });

}(app.module('menu')));

(function(Search) {

  Search.Model = Backbone.Model.extend({
    queue: function() {
      var url = 'rooms/' + app.room + '/queue';
      app.api(url, 'POST', this.attributes, function() {});
    }
  });

  Search.View = Backbone.View.extend({
      tagName: 'li'

    , events: {
        'click button': 'queue'
      }

    , queue: function() {
        this.model.queue();
      }

    , render: function() {
        var html = Mustache.to_html(this.template, this.model.attributes);
        this.$el.html(html);
        return this;
      }

    , initialize: function() {
        _.bindAll(this);
        this.template = $('#result-tmpl').html();
      }
  });

  Search.Collection = Backbone.Collection.extend({
    search: function(query) {
      var models
        , that = this
        , url = 'https://gdata.youtube.com/feeds/api/videos?max-results=50&v=2&alt=json&q=' + query
        ;

      $.getJSON(url , function(results) {
        models = _.map(results.feed.entry, function(entry) {
          var vid = entry.id.$t.split(':').pop()
            , description = app.maxLength(entry.media$group.media$description.$t, 200)
            ;

          return new Search.Model({
              title: entry.title.$t
            , url: 'http://youtube.com/v/' + vid
            , thumbnail: 'http://i.ytimg.com/vi/' + vid + '/default.jpg'
            , description: description
          });
        });

        that.reset(models);
      });
    }
  });

  Search.CollectionView = Backbone.View.extend({
      className: 'search span12'

    , events: {
        'submit .search-field': 'search'
      }

    , search: function(ev) {
        ev.preventDefault();
        this.collection.search(this.$el.find('input').val());
      }

    , render: function() {
        this.$el.html(this.template);
        var $list = this.$el.find('ul');

        this.collection.each(function(model) {
          var view = new Search.View({ model: model });
          $list.append(view.render().el);
        });

        return this;
      }

    , initialize: function() {
        _.bindAll(this);
        this.template = $('#search-tmpl').html();
        this.collection.on('reset', this.render);
      }
  });

}(app.module('search')));

jQuery(function($) {
  var Router = Backbone.Router.extend({
      routes: {
          '': 'init'
        , 'rooms/:name': 'join'
      }

    , init: function() {
        app.init();
      }

    , join: function(name) {
        app.join(name);
      }
  });

  app.router = new Router();
  Backbone.history.start();
});
