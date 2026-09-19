package com.w3bray.tiktokcleaner

/**
 * Retângulo em pixels de tela, sem depender das classes do Android — assim a
 * heurística da grade roda em teste unitário comum, sem emulador.
 */
data class Box(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
    val centerX: Int get() = (left + right) / 2
    val centerY: Int get() = (top + bottom) / 2
}

object Geometry {

    /**
     * A grade do perfil tem 3 colunas, então cada célula mede cerca de 1/3 da
     * largura da tela. Reconhecer por isso sobrevive melhor a mudanças de
     * layout do que qualquer resource-id, que o TikTok troca a cada versão.
     */
    fun isGridCell(box: Box, screenWidth: Int, screenHeight: Int): Boolean =
        box.width > screenWidth * 0.27 &&
            box.width < screenWidth * 0.38 &&
            box.height > box.width * 0.8 &&
            box.height < screenHeight * 0.6 &&
            box.top > screenHeight * 0.12

    /** Células visíveis, de cima para baixo e da esquerda para a direita. */
    fun gridCells(boxes: List<Box>, screenWidth: Int, screenHeight: Int): List<Box> =
        boxes
            .filter { isGridCell(it, screenWidth, screenHeight) }
            .sortedWith(compareBy({ it.top }, { it.left }))
            // Container e filho podem ter a mesma caixa.
            .distinctBy { it.left to it.top }

    /** Miolo da caixa: mede a cor do ícone sem pegar o fundo em volta. */
    fun shrink(box: Box, ratio: Double = 0.55): Box {
        val halfWidth = (box.width * ratio / 2).toInt()
        val halfHeight = (box.height * ratio / 2).toInt()
        return Box(
            left = box.centerX - halfWidth,
            top = box.centerY - halfHeight,
            right = box.centerX + halfWidth,
            bottom = box.centerY + halfHeight,
        )
    }

    /** Vermelho da marca do TikTok (#FE2C55) e vizinhança. */
    fun isBrandRed(red: Int, green: Int, blue: Int): Boolean =
        red > 120 && red > green * 1.5 && red > blue * 1.25
}
