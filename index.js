
module.exports.verify = function (email, options, callback) {
  // Handle optional parameters
  if (!email || !options) {
    throw new Error("Missing parameters in email-verify.verify()");
  }
  else if (typeof callback === 'undefined' && options) {
    callback = options;
    options = {};
  }

  // Default Values
  if (options && !options.port) options.port = 25;
  if (options && !options.sender) options.sender = "name@example.org";
  if (options && !options.timeout) options.timeout = 0;
  if (options && !options.fqdn) options.fqdn = "mail.example.org";
  if (options && (!options.ignore || typeof options.ignore !== "number")) options.ignore = false;

  var validator = require('email-validator');

  if (!validator.validate(email)) {
      callback(null, { success: false, info: "Invalid Email Structure", addr: email });
      return false;
  }

  // Get the domain of the email address
  var domain = email.split(/[@]/)[1];

  var dns = require('dns');

  if( options.dns ){
    try {
      if( Array.isArray(options.dns) ){
        dns.setServers(options.dns);
      }
      else{
        dns.setServers([options.dns]);
      }
    }
    catch(e){
      throw new Error("Invalid DNS Options");
    }
  }

  // Get the MX Records to find the SMTP server
  dns.resolveMx(domain, function(err,addresses) {
    if (err || (typeof addresses === 'undefined')) {
      callback(err, null);
    }
    else if (addresses && addresses.length <= 0) {
      callback(null, { success: false, info: "No MX Records" });
    }
    else{
        // Find the lowest priority mail server
        var priority = 10000;
        var index = 0;
        for (var i = 0 ; i < addresses.length ; i++) {
            if (addresses[i].priority < priority) {
                priority = addresses[i].priority;
                index = i;
            }
        }
        var smtp = addresses[index].exchange;
        var stage = 0;

        var net = require('net');
        var http = require('http');

        var socket;
      
        function setSocket(res, _socket, head) {
          socket = _socket;
      
          if (options.timeout > 0) {
            socket.setTimeout(options.timeout, function() {
              if( !calledback ){
                calledback = true;
                callback(null,
                         {
                            success: false,
                            info: "Connection Timed Out",
                            addr: email
                         });
              }
              socket.destroy()
            });
          }

          socket.on('data', socketOnData);
          socket.on('connect', socketOnConnect);
          socket.on('error', socketOnError);
          socket.on('end', socketOnEnd);
        }
        
        if (!options.proxy) {
          socket = net.createConnection(options.port, smtp);
          setSocket(null, _socket);
        } else {
          var req = http.request({
            host: options.proxy.match(/^[^:]*/) [0],
            port: (options.proxy.match(/:(.*)$/) || []) [1],
            method: 'CONNECT',
            path: smtp + ':' + options.port
          });
      
          req.on('connect', setSocket);
          req.on('error', socketOnError)
          req.end();
        }

        var success = false;
        var unknown = false;
        var response = "";
        var completed = false;
        var calledback = false;
        var ended = false;

        function socketOnData(data) {
          response += data.toString();
          completed = response.slice(-1) === '\n';

          if (completed) {
              switch(stage) {
                  case 0: if (response.indexOf('220') > -1 && !ended) {
                              // Connection Worked
                              socket.write("EHLO "+options.fqdn+"\r\n",function() { stage++; response = ""; });
                          }
                          else{
                              socket.end();
                          }
                          break;
                  case 1: if (response.indexOf('250') > -1 && !ended) {
                              // Connection Worked
                              socket.write("MAIL FROM:<"+options.sender+">\r\n",function() { stage++; response = ""; });
                          }
                          else{
                              socket.end();
                          }
                          break;
                  case 2: if (response.indexOf('250') > -1 && !ended) {
                              // MAIL Worked
                              socket.write("RCPT TO:<" + email + ">\r\n",function() { stage++; response = ""; });
                          }
                          else{
                              socket.end();
                          }
                          break;
                  case 3: if ((response.indexOf('250') > -1 || (options.ignore && response.indexOf(options.ignore) > -1)) && !ended) {
                              // RCPT TO target Worked
                              success = true;
                              socket.write("RCPT TO:<someknowninvalid" + email + ">\r\n",function() { stage++; response = ""; });
                          }
                          else{
                              socket.end();
                          }
                          break;
                  case 4: if (response.indexOf('250') > -1 || (options.ignore && response.indexOf(options.ignore) > -1)) {
                              // RCPT TO test invalid  Worked
                              unknown = true;
                          }
                          stage++;
                          response = "";
                          // close the connection cleanly.
                          if(!ended) socket.write("QUIT\r\n");
                          break;
                  case 5:
                    socket.end();
              }
          }
        }
        
        function socketOnConnect(data) {

        }
        
        function socketOnError(err) {
          ended = true;
          if( !calledback ){
            calledback = true;
            callback( err, { success: false, info: null, addr: email });
          }
        }
        
        function socketOnEnd() {
          ended = true;
          if( !calledback ){
            calledback = true;
            callback(null, {
              success: success,
              unknown: unknown,
              info: (email + " is " + (success ? "a valid" : "an invalid") + " address"),
              addr: email });
          }
        };
    }
  });
  return true;
}
