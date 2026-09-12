export interface PhotoFrameProps {
  photoUrl: string;
  frameUrl: string;
  width: number;
  height: number;
}

/**
 * A tenant-uploaded decorative frame (transparent PNG) composited on top of
 * a real photo — no code-generated brand chrome, no text. The photo is
 * cover-fit (scaled to fill the whole canvas, cropping the overflow) via the
 * same background-image trick SocialPostTemplate uses, so mismatched source
 * aspect ratios never leave empty space around the frame.
 */
export function PhotoFrameTemplate({ photoUrl, frameUrl, width, height }: PhotoFrameProps) {
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        // Quoted: an unquoted url() breaks on any URL containing a space or
        // parentheses — a real filename shape (e.g. a duplicate upload's
        // "... (1).jpg"), not a hypothetical. Confirmed live: the whole
        // background silently failed (blank white) on exactly such a file.
        background: `url("${photoUrl}") center/cover no-repeat`,
      }}
    >
      <img
        src={frameUrl}
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
