"""Small deterministic PyTorch exercises for neural-network fundamentals.

The examples deliberately use synthetic tensors only.  Forecasting data,
training/validation/test partitions, services, and model artifacts belong to
later Phase 6 subphases.
"""

from dataclasses import dataclass

import torch
from torch import Tensor, nn


DEFAULT_INPUTS = (2.0, -1.0, 3.0)
DEFAULT_WEIGHTS = (0.5, 1.0, -0.25)
DEFAULT_BIAS = 0.75


@dataclass(frozen=True)
class OptimizationStep:
    """Observable values from one forward/backward/optimizer cycle."""

    prediction: Tensor
    target: Tensor
    loss: Tensor
    weight_gradient: Tensor
    bias_gradient: Tensor
    weight_before: Tensor
    weight_after: Tensor
    bias_before: Tensor
    bias_after: Tensor


def tensor_examples() -> dict[str, Tensor]:
    """Return scalar, vector, and matrix examples with explicit dtypes."""
    return {
        "scalar": torch.tensor(3.0, dtype=torch.float32),
        "vector": torch.tensor([1.0, 2.0, 3.0], dtype=torch.float32),
        "matrix": torch.tensor([[1, 2, 3], [4, 5, 6]], dtype=torch.int64),
    }


def manual_neuron(
    inputs: Tensor,
    weights: Tensor,
    bias: Tensor | float,
) -> Tensor:
    """Calculate one neuron's affine value: ``z = x · w + b``."""
    if inputs.ndim != 1 or weights.ndim != 1 or inputs.shape != weights.shape:
        raise ValueError("inputs and weights must be one-dimensional with equal shape")
    return torch.dot(inputs, weights) + torch.as_tensor(
        bias, dtype=inputs.dtype, device=inputs.device
    )


def relu(values: Tensor) -> Tensor:
    """Apply the ReLU activation, replacing negative values with zero."""
    return torch.relu(values)


def configured_linear_neuron() -> tuple[Tensor, Tensor]:
    """Return matching outputs from manual arithmetic and ``nn.Linear``."""
    inputs = torch.tensor(DEFAULT_INPUTS, dtype=torch.float32)
    weights = torch.tensor(DEFAULT_WEIGHTS, dtype=torch.float32)
    bias = torch.tensor(DEFAULT_BIAS, dtype=torch.float32)
    layer = nn.Linear(3, 1)
    with torch.no_grad():
        layer.weight.copy_(weights.unsqueeze(0))
        layer.bias.copy_(bias.unsqueeze(0))
    manual_output = manual_neuron(inputs, weights, bias)
    layer_output = layer(inputs).squeeze(0)
    return manual_output, layer_output


def small_forward_pass(inputs: Tensor) -> Tensor:
    """Run deterministic input → linear → ReLU → linear computation."""
    if inputs.ndim != 2 or inputs.shape[1] != 2:
        raise ValueError("inputs must have shape (batch, 2)")
    hidden = nn.Linear(2, 2)
    output = nn.Linear(2, 1)
    with torch.no_grad():
        hidden.weight.copy_(torch.tensor([[1.0, -1.0], [0.5, 0.5]]))
        hidden.bias.copy_(torch.tensor([0.0, 0.25]))
        output.weight.copy_(torch.tensor([[0.75, -0.5]]))
        output.bias.copy_(torch.tensor([0.1]))
    return output(relu(hidden(inputs.to(dtype=torch.float32))))


def one_optimization_step() -> OptimizationStep:
    """Perform one deterministic MSE/backpropagation/SGD demonstration."""
    layer = nn.Linear(2, 1)
    with torch.no_grad():
        layer.weight.copy_(torch.tensor([[0.25, -0.5]]))
        layer.bias.copy_(torch.tensor([0.1]))

    inputs = torch.tensor([[1.0, 2.0]], dtype=torch.float32)
    target = torch.tensor([[1.5]], dtype=torch.float32)
    optimizer = torch.optim.SGD(layer.parameters(), lr=0.1)

    weight_before = layer.weight.detach().clone()
    bias_before = layer.bias.detach().clone()
    prediction = layer(inputs)
    loss = nn.functional.mse_loss(prediction, target)
    optimizer.zero_grad()
    loss.backward()

    if layer.weight.grad is None or layer.bias.grad is None:
        raise RuntimeError("backpropagation did not produce parameter gradients")
    weight_gradient = layer.weight.grad.detach().clone()
    bias_gradient = layer.bias.grad.detach().clone()
    optimizer.step()

    return OptimizationStep(
        prediction=prediction.detach().clone(),
        target=target,
        loss=loss.detach().clone(),
        weight_gradient=weight_gradient,
        bias_gradient=bias_gradient,
        weight_before=weight_before,
        weight_after=layer.weight.detach().clone(),
        bias_before=bias_before,
        bias_after=layer.bias.detach().clone(),
    )
