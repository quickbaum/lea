(function () {
    function dates(p) {
        if (p.born == null && p.died == null)
            return '';
        return (p.born == null ? '' : p.born) + '–' + (p.died == null ? '' : p.died);
    }
    function card(p, opts, withMeta) {
        var el = document.createElement(p.exists && p.id ? 'a' : 'span');
        el.className = 'bub-lin-card' + (p.exists ? '' : ' missing') +
            (p.sex ? ' sex-' + p.sex : '');
        if (p.exists && p.id) {
            el.href = '#' + p.id;
            el.addEventListener('click', function (e) {
                e.preventDefault();
                if (opts && opts.onOpen)
                    opts.onOpen(p.id, p);
            });
        }
        if (p.preview) {
            var face = document.createElement('img');
            face.className = 'bub-lin-face';
            face.src = p.preview;
            face.alt = '';
            face.loading = 'lazy';
            el.appendChild(face);
        }
        var text = document.createElement('span');
        text.className = 'bub-lin-text';
        var name = document.createElement('span');
        name.className = 'bub-lin-name';
        name.textContent = p.name;
        text.appendChild(name);
        var bits = [];
        if (withMeta && p.rel)
            bits.push(p.rel);
        var d = dates(p);
        if (d)
            bits.push(d);
        if (bits.length) {
            var meta = document.createElement('span');
            meta.className = 'bub-lin-meta';
            meta.textContent = bits.join(' · ');
            text.appendChild(meta);
        }
        el.appendChild(text);
        return el;
    }
    function outline(nodes, opts) {
        var ul = document.createElement('ul');
        ul.className = 'bub-lin-tree';
        nodes.forEach(function (n) {
            var li = document.createElement('li');
            if (n.rel)
                li.dataset.rel = n.rel;
            li.appendChild(card(n, opts, false));
            if (n.kids && n.kids.length)
                li.appendChild(outline(n.kids, opts));
            ul.appendChild(li);
        });
        return ul;
    }
    window.bubLineage = {
        tree: function (host, data, opts) {
            host.innerHTML = '';
            if (!data || !data.tree)
                return host;
            host.appendChild(outline([data.tree], opts));
            return host;
        },
        render: function (host, data, opts) {
            host.innerHTML = '';
            if (!data)
                return host;
            var list = document.createElement('div');
            list.className = 'bub-lin-list';
            [].concat(data.up || [], data.side || [], data.down || [])
                .forEach(function (p) { list.appendChild(card(p, opts, true)); });
            if (!list.children.length)
                return host;
            host.appendChild(list);
            return host;
        },
    };
})();
