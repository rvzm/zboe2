<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ZBOE — Login</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.1/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body{
      min-height: 100vh;
      background: radial-gradient(1000px 500px at 20% 0%, rgba(13,110,253,.15), transparent 60%),
                  radial-gradient(900px 500px at 80% 0%, rgba(25,135,84,.12), transparent 60%),
                  #0b0f14;
    }
    .soft-card{
      background: rgba(255,255,255,.03);
      border-color: rgba(255,255,255,.12);
    }
    .soft-card .card-header{
      background: rgba(255,255,255,.04);
      border-color: rgba(255,255,255,.12);
    }
    .muted-mono{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      color: rgba(255,255,255,.65);
      font-size: .9rem;
    }
  </style>
</head>
<body class="text-light d-flex align-items-center">
  <div class="container">
    <div class="row justify-content-center">
      <div class="col-12 col-md-7 col-lg-5">

        <div class="text-center mb-3">
          <div class="display-6 fw-semibold">🧟 ZBOE</div>
          <div class="muted-mono">Zombie Bot of Eternal… something</div>
        </div>

        <div class="card soft-card shadow">
          <div class="card-header">
            <div class="fw-semibold">Login</div>
            <div class="muted-mono">Enter your credentials to join the global hunt</div>
          </div>
          <div class="card-body">
            <!-- Demo: posts to /login -->
            <form method="post" action="/login" class="vstack gap-3">
              <div>
                <label class="form-label">Username</label>
                <input name="username" class="form-control" autocomplete="username" required />
              </div>

              <div>
                <label class="form-label">Password</label>
                <input name="password" type="password" class="form-control" autocomplete="current-password" required />
              </div>

              <!-- Optional: flash message area (server can inject ?err=) -->
              <div class="text-warning small" id="msg" style="display:none;"></div>

              <button class="btn btn-success w-100" type="submit">Login</button>

              <div class="d-flex justify-content-between align-items-center">
                <a class="link-light small" href="#" onclick="alert('Wire up password reset later 😅'); return false;">Forgot password?</a>
                <a class="link-info small" href="/register">Register</a>
              </div>
            </form>
          </div>
          <div class="card-footer muted-mono">
            Tip: For demo auth, server.js uses an in-memory user store.
          </div>
        </div>

        <div class="text-center mt-3 muted-mono">
          By logging in, you agree to shoot zombies and not cry about jams.
        </div>

      </div>
    </div>
  </div>

  <script>
    // simple querystring message display: /login?err=Bad%20login
    const p = new URLSearchParams(location.search);
    const err = p.get("err");
    if (err) {
      const el = document.getElementById("msg");
      el.style.display = "block";
      el.textContent = err;
    }
  </script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.1/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
