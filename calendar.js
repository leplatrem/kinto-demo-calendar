$(document).ready(function() {
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
    // XXX: load
    callback([]);
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
    var event = Object.assign({}, fcEvent);
    event.start = fcEvent.start.format();
    event.end = fcEvent.end.format();

    // XXX: save event

    _calendar.fullCalendar('updateEvent', fcEvent);
  }

  //
  // jQuery UI dialog to create/delete/save
  //
  function eventDialog(event) {
    var isNew = event.title === undefined;

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
          // XXX: delete event.id

          _calendar.fullCalendar('removeEvents', event.id);
          $dialog.dialog('close');
        };
      }

      actions['Save'] = function () {
        event['title'] = $dialog.find('#title').val();

        // XXX: save event

        $dialog.dialog('close');

        var action = isNew ? 'renderEvent' : 'updateEvent';
        _calendar.fullCalendar(action, event);

      };

      return actions;
    }
  }
});
