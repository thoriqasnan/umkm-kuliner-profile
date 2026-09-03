import pytest
import torch

from sari_rasa_data.deep_learning_foundations import (
    configured_linear_neuron,
    manual_neuron,
    one_optimization_step,
    relu,
    small_forward_pass,
    tensor_examples,
)


def test_tensor_examples_have_expected_shapes_and_dtypes() -> None:
    examples = tensor_examples()

    assert examples["scalar"].shape == torch.Size([])
    assert examples["vector"].shape == torch.Size([3])
    assert examples["matrix"].shape == torch.Size([2, 3])
    assert examples["scalar"].dtype == torch.float32
    assert examples["vector"].dtype == torch.float32
    assert examples["matrix"].dtype == torch.int64


def test_manual_neuron_uses_weighted_sum_and_bias() -> None:
    inputs = torch.tensor([2.0, -1.0, 3.0])
    weights = torch.tensor([0.5, 1.0, -0.25])

    result = manual_neuron(inputs, weights, 0.75)

    assert torch.equal(result, torch.tensor(0.0))


def test_manual_neuron_rejects_incompatible_shapes() -> None:
    with pytest.raises(ValueError, match="equal shape"):
        manual_neuron(torch.ones(2), torch.ones(3), 0.0)


def test_relu_replaces_only_negative_values() -> None:
    values = torch.tensor([-2.0, 0.0, 3.5])

    assert torch.equal(relu(values), torch.tensor([0.0, 0.0, 3.5]))


def test_configured_linear_matches_manual_neuron() -> None:
    manual_output, layer_output = configured_linear_neuron()

    assert torch.equal(manual_output, layer_output)


def test_small_forward_pass_has_finite_scalar_output_per_row() -> None:
    inputs = torch.tensor([[2.0, 1.0], [-1.0, 3.0]])

    output = small_forward_pass(inputs)

    assert output.shape == torch.Size([2, 1])
    assert torch.isfinite(output).all()


def test_optimization_step_produces_finite_loss_and_gradients() -> None:
    result = one_optimization_step()

    assert result.prediction.shape == result.target.shape == torch.Size([1, 1])
    assert result.loss.ndim == 0
    assert torch.isfinite(result.loss)
    assert torch.isfinite(result.weight_gradient).all()
    assert torch.isfinite(result.bias_gradient).all()


def test_optimizer_changes_trainable_parameters() -> None:
    result = one_optimization_step()

    assert not torch.equal(result.weight_before, result.weight_after)
    assert not torch.equal(result.bias_before, result.bias_after)


def test_foundation_examples_are_deterministic() -> None:
    first_forward = small_forward_pass(torch.tensor([[1.0, 2.0]]))
    second_forward = small_forward_pass(torch.tensor([[1.0, 2.0]]))
    first_step = one_optimization_step()
    second_step = one_optimization_step()

    assert torch.equal(first_forward, second_forward)
    assert torch.equal(first_step.loss, second_step.loss)
    assert torch.equal(first_step.weight_gradient, second_step.weight_gradient)
    assert torch.equal(first_step.weight_after, second_step.weight_after)
