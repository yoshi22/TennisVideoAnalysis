"""
_compat.py — shim for rfdetr 1.10.x against transformers 5.x.

rfdetr's DINOv2 backbone does `from transformers import BackboneConfigMixin,
BackboneMixin`, but transformers 5.x no longer re-exports these at the top level
(they live in `transformers.backbone_utils`). Import this module BEFORE importing
rfdetr to restore the expected top-level names.

Usage:
    import _compat  # noqa: F401  (must precede `import rfdetr`)
    from rfdetr import RFDETRNano
"""

from __future__ import annotations

import transformers

for _name in ("BackboneConfigMixin", "BackboneMixin"):
    if not hasattr(transformers, _name):
        try:
            from transformers import backbone_utils as _bu

            setattr(transformers, _name, getattr(_bu, _name))
        except Exception:  # pragma: no cover - best effort
            from transformers.utils import backbone_utils as _bu2

            setattr(transformers, _name, getattr(_bu2, _name))
