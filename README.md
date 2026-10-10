# Bottega

The working platform for an artist's practice: gear and manuals, projects of
every kind (music sessions, installations, multimedia, collections), where each
stands in its stages, a study group's notes, and a Claude connector over all of
it. The first instance serves Sirsinate Sound Labs.

Next.js on Vercel, Neon Postgres, Cloudflare R2. See `docs/REQUIREMENTS.md` and
`docs/ARCHITECTURE.md`.

## Running it

    cp .env.example .env.local      # fill in
    /opt/homebrew/bin/python3.13 -m venv pipeline/.venv
    pipeline/.venv/bin/pip install -r pipeline/requirements.txt
    pipeline/.venv/bin/python3 pipeline/migrate.py --status
    pipeline/.venv/bin/python3 pipeline/migrate.py
    npm run dev
