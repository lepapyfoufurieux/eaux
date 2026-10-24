"""Normalise uploaded photos: right way up, bounded size, no metadata left in the published file."""

from io import BytesIO

from django.core.files.base import ContentFile
from PIL import Image, ImageOps

PHOTO_MAX_PX = 1600
THUMB_MAX_PX = 480


def _jpeg(image, max_px, name):
    copy = image.copy()
    copy.thumbnail((max_px, max_px))
    buffer = BytesIO()
    # Saving without `exif=` drops every tag, GPS position included.
    copy.save(buffer, "JPEG", quality=80, optimize=True)
    return ContentFile(buffer.getvalue(), name=name)


def process_photo(uploaded, basename):
    """Return (photo, thumbnail) as JPEG files ready to assign to ImageFields. Raises ValueError if unreadable."""
    try:
        image = Image.open(uploaded)
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception as exc:  # Pillow raises many different errors for bad files
        raise ValueError("unreadable image") from exc
    return _jpeg(image, PHOTO_MAX_PX, f"{basename}.jpg"), _jpeg(image, THUMB_MAX_PX, f"{basename}.jpg")
