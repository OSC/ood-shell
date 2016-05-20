// Monkey patch Regexp because Javascript is sad
RegExp.escape = function(s) {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};

var express  = require('express');
var exphbs   = require('express-handlebars');
var http     = require('http');
var path     = require('path');
var server   = require('socket.io');
var pty      = require('pty.js');
var fs       = require('fs');

var BASE_URI  = require('base-uri');
var SSH_URI   = "/ssh"
var PORT      = 1337;
var URI_REGEX = RegExp.escape(BASE_URI) +
                RegExp.escape(SSH_URI) +
                '\\/([^\\/]+)' +
                '(.*)$';

var sshport  = 22;
var sshhosts = {
  oakley: 'oakley.osc.edu',
  ruby:   'ruby.osc.edu',
  dev:    'websvcs08.osc.edu'
};
var default_host = 'oakley';

// Use express to handle the routes and rendering
var app = express();

// Use handlebars as the renderer
app.engine('handlebars', exphbs());
app.set('view engine', 'handlebars');

// Set up the routes
app.get(BASE_URI + SSH_URI + '/*', function(req, res) {
  res.render('index', {
    baseURI: BASE_URI
    // FIXME: we could provide an alternate menu
    // that will let you switch color schemes/themes on the fly
    // or add new ones (actually just drop in "themes" in a directory and
    // restart to make them available :-P)
  });
});
app.use(BASE_URI + '/wetty', express.static(path.join(__dirname, 'node_modules/wetty/public/wetty')));

// Start up the http server
var httpserv = http.createServer(app).listen(PORT, function() {
  console.log('http on port ' + PORT);
});

// Start up socket server
var io = server(httpserv, {
  path: BASE_URI + '/socket.io'
});

io.on('connection', function(socket) {
  var request = socket.request;
  console.log((new Date()) + ' Connection accepted.');

  // find user requested host from white list of hosts as well as user
  // requested cwd
  var sshhost = sshhosts[default_host];
  var cwd = null;
  if (match = request.headers.referer.match(URI_REGEX)) {
    // check if host exists
    if (match[1] in sshhosts) {
      sshhost = sshhosts[match[1]];
    }
    // check if dir exists and user has access to it
    var tmpdir = process.cwd();
    try {
      process.chdir(match[2]);
      cwd = match[2];
    } catch (err) {
      // ignore
    }
    process.chdir(tmpdir);
  }

  process.env.LANG = 'en_US.UTF-8'; // fixes strange character issues

  // set up arguments for launching ssh session
  var term_args = [sshhost, '-p', sshport];
  if (cwd !== null) {
    term_args.push('-t', 'cd ' + cwd + ' ; exec bash -l');
  }

  // launch an ssh session
  var term = (function(){
    if(sshhost === 'websvcs08.osc.edu'){
      return pty.spawn('scl', ['enable', 'git19', 'bash -l'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,

        // this is where we add a GET PARAM to specify to cd to the particular directory
        cwd: cwd || process.env.HOME
      });
    }
    else{
      return pty.spawn('ssh', term_args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 30
      });
    }
  })();

  // FIXME: set terminal colors solarized:
  // term.prefs_.set()

  // Disable bold.
  // term.prefs_.set('enable-bold', false);
  //
  // // Use this for Solarized Dark
  //
  // term.prefs_.set('background-color', "#002B36");
  // term.prefs_.set('foreground-color', "#839496");

  //
  // // Use this for Solarized Light
  // term.prefs_.set('background-color', "#fdf6e3");
  // term.prefs_.set('foreground-color', "#657b83");
  //
  // // And of course you can adjust the font-family, font-size, font-
  // // smoothing values to your liking.  I use this:
  // term.prefs_.set('font-family', 'Menlo')
  // term.prefs_.set('font-size', 12)
  // term.prefs_.set('font-smoothing', 'subpixel-antialiased')


  console.log((new Date()) + " PID=" + term.pid + " STARTED on behalf of user");

  term.on('data', function(data) {
    socket.emit('output', data);
  });
  term.on('exit', function(code) {
    console.log((new Date()) + " PID=" + term.pid + " ENDED");
  });

  socket.on('resize', function(data) {
    term.resize(data.col, data.row);
  });
  socket.on('input', function(data) {
    term.write(data);
  });
  socket.on('disconnect', function() {
    term.end();
  });

  // app.get(BASE_URI + '/foo', function(req, res) {
  //   res.send(term.pid);
  // });
});
