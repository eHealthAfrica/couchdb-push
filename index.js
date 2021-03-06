// couchdb-push
// (c) 2014 Johannes J. Schmidt

var crypto = require('crypto');
var assert = require('assert');
var async = require('async');
var nanoOption = require('nano-option');
var compile = require('couchdb-compile');
var ensure = require('couchdb-ensure');
var chokidar = require('chokidar');


module.exports = function push(db, source, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  try {
    db = nanoOption(db);
  } catch(e) {
    return callback({ error: 'invalid_db', reason: 'Not a valid database: ' + url });
  }

  if (!db.config.db) {
    return callback({ error: 'no_db', reason: 'Not a database: ' + db });
  }

  function pushDoc(doc, attachments, done) {
    if (options.multipart && attachments.length) {
      db.multipart.insert(doc, attachments, doc._id, done);
    } else {
      db.insert(doc, doc._id, done);
    }
  }

  function diffAttachment(attachment, existingAttachment) {
    if (!existingAttachment) {
      return false;
    }

    var md5sum = crypto.createHash('md5');
    var data = options.multipart ? attachment.data : new Buffer(attachment.data, 'base64');
    md5sum.update(data);
    var digest = 'md5-' + md5sum.digest('base64');

    return existingAttachment.digest === digest;
  }

  function diffDoc(doc, existingDoc, attachments, done) {
    doc._rev = existingDoc._rev;

    if (options.multipart) {
      if (attachments.length) {
        for (var i = 0; i < attachments.length; i++) {
          var name = attachments[i].name;
          var identical = diffAttachment(attachments[i], existingDoc && existingDoc._attachments && existingDoc._attachments[name]);

          if (identical) {
            doc._attachments = doc._attachments || {};
            doc._attachments[name] = existingDoc._attachments[name];
            attachments.splice(i--, 1);
          }
        };
      }
    } else {
      if (doc._attachments) {
        Object.keys(doc._attachments).forEach(function(name) {
          var identical = diffAttachment(doc._attachments[name], existingDoc && existingDoc._attachments && existingDoc._attachments[name]);

          if (identical) {
            doc._attachments[name] = existingDoc._attachments[name];
          }
        });
      }
    }

    try {
      assert.deepEqual(doc, existingDoc);
      if (options.multipart) {
        assert.equal(attachments.length, 0);
      }

      done(null, { ok: true, id: doc._id, rev: doc._rev, unchanged: true });
    } catch(e) {
      pushDoc(doc, attachments, done);
    }
  }

  function getDoc(doc, attachments, done) {
    db.get(doc._id, function(err, response) {
      if (err && err.statusCode === 404) {
        return pushDoc(doc, attachments, done);
      }

      diffDoc(doc, response, attachments, done);
    })
  }

  
  function compileDoc(done) {
    compile(source, options, function(err, doc, attachments) {
      if (err) {
        return done(err);
      }

      if (!doc._id) {
        return done({ error: 'missing_id', reason: 'Missing _id property' });
      }

      attachments = attachments || [];

      getDoc(doc, attachments, done);
    });
  }


  ensure(db, function(error) {
    if (error) {
      return callback(error);
    }

    if (options.watch) {
      var queue = async.queue(function(task, done) {
        compileDoc(function(error, response) {
          error ? console.error(error) :
            console.log(JSON.stringify(response, null, '  '))
          done(error)
        })
      }, 1)

      chokidar
        .watch(source, { ignoreInitial: true })
        .on('all', queue.push);
    }
    
    compileDoc(callback);
  });
};
