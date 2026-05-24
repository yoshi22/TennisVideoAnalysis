#!/usr/bin/env python3
"""Small temporal models for frame-level rally-state classification."""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class CausalConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int, dilation: int):
        super().__init__()
        self.left_pad = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(
            in_channels,
            out_channels,
            kernel_size=kernel_size,
            dilation=dilation,
        )
        self.activation = nn.ReLU()
        self.proj = nn.Conv1d(in_channels, out_channels, kernel_size=1) if in_channels != out_channels else None

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x if self.proj is None else self.proj(x)
        y = F.pad(x, (self.left_pad, 0))
        y = self.activation(self.conv(y))
        return self.activation(y + residual)


class RallyStateModel(nn.Module):
    def __init__(self, input_dim: int, model_type: str = "tcn"):
        super().__init__()
        if model_type not in {"tcn", "gru"}:
            raise ValueError("model_type must be 'tcn' or 'gru'")
        self.input_dim = int(input_dim)
        self.model_type = model_type

        if model_type == "tcn":
            self.net = nn.Sequential(
                CausalConvBlock(input_dim, 32, kernel_size=5, dilation=1),
                CausalConvBlock(32, 32, kernel_size=5, dilation=2),
                CausalConvBlock(32, 32, kernel_size=5, dilation=4),
            )
            self.head = nn.Conv1d(32, 1, kernel_size=1)
        else:
            self.gru = nn.GRU(
                input_dim,
                hidden_size=32,
                num_layers=2,
                batch_first=True,
                bidirectional=True,
            )
            self.head = nn.Linear(64, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (T, input_dim) or (B, T, input_dim) -> logits: (T,) or (B, T)."""
        squeeze_batch = x.dim() == 2
        if squeeze_batch:
            x = x.unsqueeze(0)

        if self.model_type == "tcn":
            y = x.transpose(1, 2)
            y = self.net(y)
            logits = self.head(y).squeeze(1)
        else:
            y, _ = self.gru(x)
            logits = self.head(y).squeeze(-1)

        return logits.squeeze(0) if squeeze_batch else logits
