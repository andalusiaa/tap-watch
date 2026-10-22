-- The words on the About, How it works, Questions and Privacy pages, so they can be edited
-- on the admin page instead of in the code. Stored as simple text (headings with ##, bullets
-- with -, links as [text](address)), never raw HTML, so nothing can inject markup.

CREATE TABLE pages (
  slug TEXT PRIMARY KEY,                     -- 'about', 'how-it-works', 'faq', 'privacy'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
