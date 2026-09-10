'use strict';
module.exports = {
  ...require('./tencent'),
  ...require('./translator'),
  ...require('./remote-stream'),
  ...require('./decimator'),
  ...require('./transcript'),
  ...require('./recorder'),
  schema: require('./schema'),
};
