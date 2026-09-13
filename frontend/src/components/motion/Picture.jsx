import { cn } from "@/lib/utils";
import { imgUrl, srcSetFor } from "@/lib/images";

export const Picture = ({ image, className, imgClassName, sizes = "100vw", priority = false, ratio, ...rest }) => (
  <div className={cn("picture-frame relative overflow-hidden bg-ivory-2", className)} style={ratio ? { aspectRatio: ratio } : undefined} {...rest}>
    <img
      src={imgUrl(image, 1440)}
      srcSet={srcSetFor(image)}
      sizes={sizes}
      alt={image.alt || ""}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      draggable="false"
      className={cn("absolute inset-0 h-full w-full object-cover", imgClassName)}
    />
  </div>
);

// Keep the public API stable while image motion remains disabled for readability.
export const ParallaxImage = ({ strength, ...props }) => <Picture {...props} />;
