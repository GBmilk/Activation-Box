/* =========================================================
   外观预热 · appearance-init
   ---------------------------------------------------------
   这一段必须放在 <head> 里、样式表之前执行。
   它的唯一职责：在浏览器首次绘制之前，把用户上次选择的外观
   写到 <html> 上 —— 两条轴分别对应两个属性：

     data-theme  主题颜色   forest 森林绿 | violet 紫光蓝 | amber 橙渐白
     data-mode   明暗模式   night 黑夜    | day 白天

   如果不这么做，页面会先按 HTML 里写的默认外观（森林绿 + 黑夜）
   画一帧，等 app.js 执行完再切成用户实际选择的外观 ——
   那一帧就是"闪白"。在浅色外观下尤其明显。

   说明：这里的取值清单与 js/app.js 中的 THEMES / MODES 保持一致。
   两份重复是可接受的：这份是"上色前"的引导脚本，不能依赖任何
   其它文件，必须自包含、体积极小、同步执行。
   ========================================================= */

(function () {
  'use strict';

  var ATTRS = [
    { attr: 'data-theme', key: 'activation-box-theme', allowed: ['forest', 'violet', 'amber'] },
    { attr: 'data-mode',  key: 'activation-box-mode',  allowed: ['day', 'night'] }
  ];

  var root = document.documentElement;

  for (var i = 0; i < ATTRS.length; i++) {
    var item = ATTRS[i];
    try {
      var saved = localStorage.getItem(item.key);
      if (saved && item.allowed.indexOf(saved) !== -1) {
        root.setAttribute(item.attr, saved);
      }
    } catch (err) {
      /* 隐私模式 / 禁用存储时直接忽略，用 HTML 上的默认外观即可 */
    }
  }
})();
