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

      swfobject.embedSWF(url, 'player-cont', '425', '356', '8', null, null, params, atts);
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
      fetch: function() {
        var that = this
          , url = 'rooms/' + app.room + '/queue'
          ;

        app.api(url, 'GET', null, function(songs) {
          var models = _.map(songs, function(song) {
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

        if (!song) {
          console.log('Playlist finished');
          return;
        }

        song.on('finished', this.play);
        song.play();

        app.api(url, 'DELETE', null, function() {});
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
      }
  });

  Player.CollectionView = Backbone.View.extend({
      events: {
        'click .play': 'play'
      }

    , play: function() {
        this.collection.play();
      }

    , renderList: function() {
        var $list = this.$el.find('ul');

        $list.empty();

        this.collection.each(function(model) {
          var view = new Player.View({model: model});
          $list.append(view.render().el);
        });
      }

    , render: function() {
        this.$el.html(this.template);
        this.renderList();
        return this;
      }

    , initialize: function() {
        _.bindAll(this);
        this.template = $('#queue-tmpl').html();
        this.collection.on('add', this.renderList);
        this.collection.on('remove', this.renderList);
      }
  });

}(app.module('player')));

(function(Menu) {

  Menu.Model = Backbone.Model.extend({
    join: function() {
      app.join(this.get('name'));
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
      events: {
        'click .create': 'create'
      }

    , create: function() {
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
          return new Search.Model({
              title: entry.title.$t
            , url: 'http://youtube.com/v/' + entry.id.$t.split(':').pop()
          });
        });

        that.reset(models);
      });
    }
  });

  Search.CollectionView = Backbone.View.extend({
      className: 'search'

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
      }

    , init: function() {
        app.init();
      }
  });

  app.router = new Router();
  Backbone.history.start();
});
