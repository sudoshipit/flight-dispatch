# Third-party components

Flight Dispatch uses **node-simconnect 4.2.1** by Even Arneberg Rognlien,
licensed under the GNU Lesser General Public License, version 3 or later.
The library is included without changes as a separate Node.js dependency.
Its license is in `assets/licenses/node-simconnect-LGPL-3.0.txt`; the
incorporated GPL text is in `assets/licenses/GPL-3.0.txt`.

Library project and source: <https://github.com/EvenAR/node-simconnect>.
The exact distributed package is recorded in `package-lock.json`.
To replace or modify the library, obtain this application's matching source,
replace the `node-simconnect` dependency with your version, then run
`npm ci` (or `npm install` for a changed dependency), `npm run build`, and
`npm run package`. No signing key or private build service is needed.
Modification of this library and reverse engineering for debugging such
modifications are permitted under its license.

The app's SimConnect adapter accesses the pinned package's discovery helper
to handle cancellation and discovery errors before opening a connection.
The dependency itself is not patched.

The offline map uses public-domain Natural Earth geography, distributed by
`world-atlas`: <https://www.naturalearthdata.com/about/terms-of-use/>.

Other dependencies retain their respective licenses in their package
directories. Electron includes its third-party license notices with the runtime.
