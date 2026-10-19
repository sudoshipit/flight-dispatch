This certificate and intentionally public private key are fixtures for local
HTTPS integration tests only. They never serve production traffic and are not
trusted or installed in the operating system. The test browser resolves VATSIM
hosts to the local fixture server and blocks all other DNS. Certificate checking
is disabled only in that disposable browser profile. These files are excluded
from the packaged application.
