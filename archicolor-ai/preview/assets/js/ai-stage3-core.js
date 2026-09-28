/* ArchiColor AI Stage 3 · production color-core adapter */
(function (global) {
  'use strict';
  if (!global.jQuery) return;
  var $ = global.jQuery, originalAjax = $.ajax;
  function labObj(v){ return {l:Number(v.l),a:Number(v.a),b:Number(v.b)}; }
  function legacyMatch(x){ return {id:x.id, n:x.name, h:x.hex, code:x.code, de:Number(x.deltaE), url:x.url || ''}; }
  $.ajax = function (opts) {
    if (typeof opts === 'string') return originalAjax.apply($, arguments);
    opts = opts || {};
    if (opts.url !== '/ajax/color_service.php') return originalAjax.apply($, arguments);
    var colors = opts.data && opts.data.colors;
    try { if (typeof colors === 'string') colors = JSON.parse(colors); } catch(e) { colors = {}; }
    colors = colors || {};
    var keys = Object.keys(colors), targets = keys.map(function(k){ return labObj(colors[k]); });
    var dfd = $.Deferred();
    fetch('/ajax/color_search_core.php', {
      method:'POST', credentials:'same-origin',
      headers:{'Accept':'application/json','Content-Type':'application/json'},
      body:JSON.stringify({targets:targets, limit:3})
    }).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(data){
        var out={}; keys.forEach(function(k,i){ out[k]=((data.items||[])[i]||[]).map(legacyMatch); });
        if (typeof opts.success === 'function') opts.success(out);
        dfd.resolve(out);
      }).catch(function(err){ if(typeof opts.error==='function') opts.error(null,'error',err); dfd.reject(err); });
    return dfd.promise();
  };
  global.ArchiColorAIStage3 = { colorCore:'/ajax/color_search_core.php', products:'/ajax/get_product_options_v3.php', basket:'/ajax/add_to_basket_v3.php' };
})(window);
