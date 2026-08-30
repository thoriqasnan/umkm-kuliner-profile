function createCookieClient(baseUrl) {
  let sessionCookie = null;

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (sessionCookie) headers.set('Cookie', sessionCookie);

    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const cookiePair = setCookie.split(';', 1)[0];
      if (cookiePair.startsWith('session=')) sessionCookie = cookiePair;
    }
    return response;
  }

  return {
    request,
    getSessionCookie: () => sessionCookie,
    setSessionCookie: (value) => { sessionCookie = value; },
  };
}

module.exports = { createCookieClient };
