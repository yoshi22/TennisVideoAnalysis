#!/usr/bin/env python3.11
"""Minimal TrackNetV4-style heatmap model.

The network consumes three consecutive RGB frames concatenated as 9 channels
and predicts one heatmap per frame. It keeps the TrackNetV2-style
encoder/decoder backbone and adds a lightweight motion-attention fusion layer
derived from adjacent frame differences.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn


class ConvBlock(nn.Sequential):
    def __init__(self, in_channels: int, out_channels: int, conv_count: int):
        layers: list[nn.Module] = []
        for i in range(conv_count):
            current_in = in_channels if i == 0 else out_channels
            layers.extend(
                [
                    nn.Conv2d(current_in, out_channels, kernel_size=3, padding=1),
                    nn.BatchNorm2d(out_channels),
                    nn.ReLU(inplace=True),
                ]
            )
        super().__init__(*layers)


class MotionPrompt(nn.Module):
    """Learnable attention from absolute grayscale frame differences."""

    def __init__(self, scale_init: float = 10.0, bias_init: float = -2.0):
        super().__init__()
        self.scale = nn.Parameter(torch.tensor(float(scale_init)))
        self.bias = nn.Parameter(torch.tensor(float(bias_init)))

    def forward(self, frames: torch.Tensor) -> torch.Tensor:
        """frames: (B, 3, 3, H, W) -> attention: (B, 2, H, W)."""
        if frames.dim() != 5 or frames.size(1) != 3 or frames.size(2) != 3:
            raise ValueError("MotionPrompt expects frames with shape (B, 3, 3, H, W)")

        gray = frames.mean(dim=2)
        diffs = gray[:, 1:] - gray[:, :-1]
        return torch.sigmoid(self.scale * diffs.abs() + self.bias)


class MotionAwareFusion(nn.Module):
    """Gate the later heatmap logits with motion attention maps."""

    def forward(self, heatmap_logits: torch.Tensor, motion_attention: torch.Tensor) -> torch.Tensor:
        if heatmap_logits.dim() != 4 or heatmap_logits.size(1) != 3:
            raise ValueError("heatmap_logits must have shape (B, 3, H, W)")
        if motion_attention.dim() != 4 or motion_attention.size(1) != 2:
            raise ValueError("motion_attention must have shape (B, 2, H, W)")

        if motion_attention.shape[-2:] != heatmap_logits.shape[-2:]:
            motion_attention = F.interpolate(motion_attention, size=heatmap_logits.shape[-2:], mode="bilinear")

        fused = (
            heatmap_logits[:, 0],
            heatmap_logits[:, 1] * motion_attention[:, 0],
            heatmap_logits[:, 2] * motion_attention[:, 1],
        )
        return torch.stack(fused, dim=1)


class TrackNetV4(nn.Module):
    """TrackNetV2 heatmap backbone plus motion-aware output fusion."""

    def __init__(self, input_channels: int = 9, output_channels: int = 3):
        super().__init__()
        if input_channels != 9:
            raise ValueError("TrackNetV4 expects three RGB frames concatenated as 9 input channels")
        if output_channels != 3:
            raise ValueError("TrackNetV4 predicts three temporal heatmap channels")

        self.motion = MotionPrompt()
        self.fusion = MotionAwareFusion()

        self.enc1 = ConvBlock(input_channels, 64, conv_count=2)
        self.enc2 = ConvBlock(64, 128, conv_count=2)
        self.enc3 = ConvBlock(128, 256, conv_count=3)
        self.enc4 = ConvBlock(256, 512, conv_count=3)

        self.dec1 = ConvBlock(512 + 256, 256, conv_count=3)
        self.dec2 = ConvBlock(256 + 128, 128, conv_count=2)
        self.dec3 = ConvBlock(128 + 64, 64, conv_count=2)
        self.head = nn.Conv2d(64, output_channels, kernel_size=1)

        self.pool = nn.MaxPool2d(kernel_size=2, stride=2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, 9, H, W) -> logits: (B, 3, H, W)."""
        if x.dim() != 4 or x.size(1) != 9:
            raise ValueError("TrackNetV4 expects input with shape (B, 9, H, W)")

        batch, _, height, width = x.shape
        frames = x.reshape(batch, 3, 3, height, width)
        motion_attention = self.motion(frames)

        x1 = self.enc1(x)
        x2 = self.enc2(self.pool(x1))
        x3 = self.enc3(self.pool(x2))
        x4 = self.enc4(self.pool(x3))

        y = F.interpolate(x4, size=x3.shape[-2:], mode="nearest")
        y = self.dec1(torch.cat([y, x3], dim=1))
        y = F.interpolate(y, size=x2.shape[-2:], mode="nearest")
        y = self.dec2(torch.cat([y, x2], dim=1))
        y = F.interpolate(y, size=x1.shape[-2:], mode="nearest")
        y = self.dec3(torch.cat([y, x1], dim=1))

        return self.fusion(self.head(y), motion_attention)

    @torch.no_grad()
    def predict_heatmaps(self, x: torch.Tensor) -> torch.Tensor:
        """Return sigmoid probabilities for inference/evaluation."""
        return torch.sigmoid(self.forward(x))


def count_parameters(model: nn.Module) -> int:
    return sum(param.numel() for param in model.parameters() if param.requires_grad)


TrackNet = TrackNetV4
