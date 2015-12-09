$(document).ready(function() {
  // Mozilla demo server (flushed every day)
  var server = "https://kinto.dev.mozaws.net/v1";
  var bucket_id = "default";
  var collection_id = "kinto_demo_calendar"

  // Pusher app key
  var pusher_key = "01a9feaaf9ebb120d1a6";

  // Simplest credentials ever.
  var authorization =  "Basic " + btoa("public:notsecret");

  // Kinto client with sync options.
  var kinto = new Kinto({remote: server, bucket: bucket_id,
                         headers: {Authorization: authorization}});

  // Local store in IndexedDB.
  var store = kinto.collection(collection_id);

  // Setup live-sync!
  getBucketId()
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

  init();

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

  // Live changes.
  function getBucketId() {
    // When using the `default` bucket, we should resolve its real id
    // to be able to listen to notifications.
    if (bucket_id != "default")
      return Promise.resolve(bucket_id);

    return fetch(server + '/', {headers: {Authorization: authorization}})
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
    channel.bind_all(function() {
      syncServer();
    });
  }

});
