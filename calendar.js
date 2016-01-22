$(document).ready(function() {
  // Mozilla demo server (flushed every day)
  var storageServer = "https://kinto.dev.mozaws.net/v1";
  var bucket_id = "default";
  var collection_id = "kinto_demo_calendar";

  // Pusher app key (as deployed on Mozila demo server)
  var pusher_key = "01a9feaaf9ebb120d1a6";

  // Local store in IndexedDB.
  var store;

  var headers;

  // Authentication from location hash
  authenticate(window.location.hash.slice(1))
    .then(function (authInfo) {
      window.location.hash = authInfo.token;
      headers = authInfo.headers;

      // Kinto client with sync options.
      var kinto = new Kinto({remote: storageServer,
                             bucket: bucket_id,
                             headers: headers,
                             dbPrefix: authInfo.username});
      store = kinto.collection(collection_id);
    })
    // Show calendar
    .then(init)
    // Setup live-sync!
    .then(getBucketId)
    .then(setupLiveSync);


  //
  // Initialize fullCalendar
  //
  function init() {
    _calendar = $('#calendar').fullCalendar({
      header: {
        left: 'prev,next today',
        center: 'title',
        right: 'month,agendaWeek,agendaDay'
      },
      events: loadEvents,

      editable: true,
      selectable: true,
      select: onSelect,
      eventClick: eventDialog,
      eventDrop: eventDropOrResize,
      eventResize: eventDropOrResize
    });
  }

  //
  // Load existing records from backend
  //
  function loadEvents(start, end, timezone, callback) {
    // Load previously created records.
    store.list()
      .then(function(results) {
        // Add events to calendar.
        callback(results.data);
      })
      .then(syncServer);
  }

  //
  // Create event on user selection
  //
  function onSelect(startDate, endDate) {
    eventDialog({
      start: startDate.format(),
      end: endDate.format(),
    });
  }

  //
  // Update events when moved/resized
  //
  function eventDropOrResize(fcEvent) {
    var newdates = {
      start: fcEvent.start.format(),
      end: fcEvent.end ? fcEvent.end.format() : null
    };
    store.get(fcEvent.id)
      .then(function (result) {
        var newrecord = Object.assign(result.data, newdates);
        return store.update(newrecord);
      })
      .then(function (result) {
        // Update the event visually.
        _calendar.fullCalendar('updateEvent', Object.assign(fcEvent, result.data));
      })
      .then(syncServer);
  }

  //
  // jQuery UI dialog to create/delete/save
  //
  function eventDialog(event) {
    var isNew = event.id === undefined;

    var $dialog = $('#eventDialog').dialog({
      modal: true,
      title: isNew ? 'New Event' : 'Edit ' + event.title,
      open: function () {
        $(this).find('#title').val(event.title);
      },
      buttons: dialogActions()
    });


    function dialogActions() {
      var actions = {
        'Cancel': function () {
          $dialog.dialog('close');
        },
      };

      if (!isNew) {
        actions['Delete'] = function () {
          // Delete from store.
          store.delete(event.id)
            .then(function () {
              // Update the event visually.
              _calendar.fullCalendar('removeEvents', event.id);
              $dialog.dialog('close');
            })
            .then(syncServer);
        };
      }

      actions['Save'] = function () {
        var newtitle = $dialog.find('#title').val();
        var newrecord = Object.assign({}, event, {title: newtitle});
        var createOrUpdate = isNew ? store.create(newrecord) : store.update(newrecord);
        createOrUpdate
          .then(function (result) {
            $dialog.dialog('close');
            var action = isNew ? 'renderEvent' : 'updateEvent';
            _calendar.fullCalendar(action, result.data);
          })
          .then(syncServer);
      };

      return actions;
    }
  }

  function syncServer() {
    var options = {strategy: Kinto.syncStrategy.SERVER_WINS};
    store.sync(options)
      .then(function (result) {
        if (result.ok) {
          result.created.forEach(function (record) {
            _calendar.fullCalendar('renderEvent', record);
          });
          result.updated.forEach(function (record) {
            _calendar.fullCalendar('removeEvents', record.id);
            _calendar.fullCalendar('renderEvent', record);
          });
          result.deleted.forEach(function (record) {
            _calendar.fullCalendar('removeEvents', record.id);
          });
        }
      })
      .catch(function (err) {
        // Special treatment since the demo server is flushed.
        if (/flushed/.test(err.message)) {
          // Mark every local record as «new» and re-upload.
          return store.resetSyncStatus()
            .then(syncServer);
        }
        // Ignore network errors (offline)
        if (/HTTP 0/.test(err.message)) {
          console.log('Sync aborted (cannot reach server)');
          return;
        }
        throw err;
      });
  }

  //
  // Live changes.
  //
  function getBucketId() {
    // When using the `default` bucket, we should resolve its real id
    // to be able to listen to notifications.
    if (bucket_id != "default")
      return Promise.resolve(bucket_id);

    return fetch(storageServer + '/', {headers: headers})
      .then(function (result) {
        return result.json();
      })
      .then(function (result) {
        return result.user.bucket;
      });
  }

  function setupLiveSync(bucket_id) {
    var pusher = new Pusher(pusher_key, {
      encrypted: true
    });

    var channelName = `${bucket_id}-${collection_id}-record`;
    var channel = pusher.subscribe(channelName);
    channel.bind_all(syncServer);
  }

  //
  // Firefox Account login
  //
  function loginURI(website) {
    var currentWebsite = website.replace(/#.*/, '');
    var login = storageServer.replace("v1", "v1/fxa-oauth/login?redirect=");
    var redirect = encodeURIComponent(currentWebsite + '#fxa:');
    return login + redirect;
  }

  function authenticate(token) {
    // Take last token from store or generate BasicAuth user with uuid4.
    if (!token) {
      token = localStorage.getItem("lastToken") || "public";
    }
    localStorage.setItem("lastToken", token);

    var authInfo = {};

    if (token.indexOf('fxa:') === 0) {
      // Fxa token passed in URL from redirection.
      var bearerToken = token.replace('fxa:', '');
      authInfo.token = '';
      authInfo.headers = {Authorization: 'Bearer ' + bearerToken};

      $('#login').html('<a href="#">Log out</a>');
      $('#login').click(function() {
        window.location.hash = '#public';
        window.location.reload();
        return false;
      });

      // Fetch user info.
      return fetch(storageServer + '/', {headers: authInfo.headers})
        .then(function (response) {
          return response.json();
        })
        .then(function (result) {
          authInfo.username = result.user.id;
          return authInfo;
        });
    }

    // Otherwise token provided via hash (no FxA).
    // Use Basic Auth as before.
    var userpass64 = btoa(token + ":notsecret");
    authInfo.token = token;
    authInfo.username = token;
    authInfo.headers = {Authorization: 'Basic ' + userpass64};

    var uri = loginURI(window.location.href);
    $('#login').html(`<a href="${uri}">Login with Firefox Account</a>`);
    return Promise.resolve(authInfo);
  }
});
