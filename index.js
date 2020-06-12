const express = require('express')
const ogr2ogr = require('ogr2ogr')
const fs = require('fs')
const join = require('path').join
var multer = require('multer');
const cors = require('cors');

function enableCors(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'POST')
  res.header('Access-Control-Allow-Headers', 'X-Requested-With')
  res.header('Access-Control-Expose-Headers', 'Content-Disposition')
  next()
}

function optionsHandler(methods) {
  return function (req, res) {
    res.header('Allow', methods)
    res.send(methods)
  }
}

function isOgreFailureError(er) {
  return er && er.message && er.message.indexOf('FAILURE:') !== -1
}

function safelyParseJson(json) {
  try {
    if (json) return JSON.parse(json)
  } catch (e) {
    return ''
  }
}

function noop() { }

exports.createServer = function (opts) {
  if (!opts) opts = {}

  let app = express()
  app.set('views', join(__dirname, '/views'))
  app.set('view engine', 'pug')

  app.options('/convert', enableCors, optionsHandler('POST'))
  app.options('/convertJson', enableCors, optionsHandler('POST'))
  app.options('*', cors())

  app.use(express.static(join(__dirname, '/public')))
  app.get('/', function (req, res) {
    res.render('home')
  })
  const upload = multer({ dest: 'uploads/' });


  app.post('/convert', upload.single('upload'), cors(), function (req, res, next) {
    if (!req.file || !req.file.filename) {
      res.status(400).json({ error: true, msg: 'No file provided' })
      return
    }
    let ogr = ogr2ogr(req.file.path).options(['-sql', 'select *, ogr_style from entities']).env({ PROJ_LIB: 'C:\\Program Files\\GDAL\\projlib\\proj.db' });
    ogr.timeout(50000)
    if (req.body.targetSrs) {
      ogr.project(req.body.targetSrs, req.body.sourceSrs)
    }

    if ('rfc7946' in req.body) {
      ogr.options(['-lco', 'RFC7946=YES'])
    }

    if ('skipFailures' in req.body) {
      ogr.skipfailures()
    }

    if (opts.timeout) {
      ogr.timeout(opts.timeout)
    }

    res.header(
      'Content-Type',
      'forcePlainText' in req.body
        ? 'text/plain; charset=utf-8'
        : 'application/json; charset=utf-8'
    )

    if ('forceDownload' in req.body) {
      res.attachment()
    }

    ogr.exec(function (er, data) {
      fs.unlink(req.file.path, noop)

      if (isOgreFailureError(er)) {
        return res
          .status(400)
          .json({ errors: er.message.replace('\n\n', '').split('\n') })
      }

      if (er) return next(er)

      if (req.body.callback) res.write(req.body.callback + '(')
      res.write(JSON.stringify(data))
      if (req.body.callback) res.write(')')
      res.end()
    })
  });

  app.post('/convertJson', enableCors, function (req, res, next) {
    if (!req.body.jsonUrl && !req.body.json)
      return res.status(400).json({ error: true, msg: 'No json provided' })

    let json = safelyParseJson(req.body.json)

    if (req.body.json && !json)
      return res.status(400).json({ error: true, msg: 'Invalid json provided' })

    let ogr

    if (req.body.jsonUrl) {
      ogr = ogr2ogr(req.body.jsonUrl)
    } else {
      ogr = ogr2ogr(json)
    }

    if (req.body.fileName) {
      ogr.options(['-nln', req.body.fileName])
    }

    if ('skipFailures' in req.body) {
      ogr.skipfailures()
    }

    if (opts.timeout) {
      ogr.timeout(opts.timeout)
    }

    let format = req.body.format || 'shp'

    ogr.format(format).exec(function (er, buf) {
      if (isOgreFailureError(er))
        return res
          .status(400)
          .json({ errors: er.message.replace('\n\n', '').split('\n') })
      if (er) return next(er)
      res.header('Content-Type', 'application/zip')
      res.header(
        'Content-Disposition',
        'filename=' + (req.body.outputName || 'ogre.zip')
      )
      res.end(buf)
    })
  })

  /* eslint no-unused-vars: [0, { "args": "none" }] */
  app.use(function (er, req, res, next) {
    console.error(er.stack)
    res.header('Content-Type', 'application/json')
    res.status(500).json({ error: true, msg: er.message })
  })

  return app
}
