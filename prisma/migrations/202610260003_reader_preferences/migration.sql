-- Per-account reader settings. Anonymous/device settings stay in browser storage.
CREATE TABLE app."ReaderPreference" (
  "userId" uuid NOT NULL PRIMARY KEY,
  theme varchar(10) NOT NULL DEFAULT 'paper',
  "fontSize" integer NOT NULL DEFAULT 18,
  "fontFamily" varchar(10) NOT NULL DEFAULT 'system',
  "lineSpacing" integer NOT NULL DEFAULT 175,
  "reducedMotion" boolean NOT NULL DEFAULT false,
  "updatedAt" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "ReaderPreference_theme_check" CHECK (theme IN ('paper','sepia','night')),
  CONSTRAINT "ReaderPreference_font_size_check" CHECK ("fontSize" IN (16,18,21,24)),
  CONSTRAINT "ReaderPreference_font_family_check" CHECK ("fontFamily" IN ('system','serif','mono')),
  CONSTRAINT "ReaderPreference_line_spacing_check" CHECK ("lineSpacing" IN (150,175,200)),
  CONSTRAINT "ReaderPreference_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES app."User"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
